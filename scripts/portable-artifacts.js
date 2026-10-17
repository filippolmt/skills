const fs = require('fs');
const path = require('path');

function copySelfContained(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    if (item.isDirectory()) copySelfContained(from, to);
    else if (item.isSymbolicLink()) {
      const target = fs.realpathSync(from);
      if (fs.statSync(target).isDirectory()) copySelfContained(target, to);
      else {
        fs.copyFileSync(target, to);
        fs.chmodSync(to, fs.statSync(target).mode & 0o777);
      }
    } else if (item.isFile()) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    }
  }
}

// The `name:` of a SKILL.md's frontmatter block, unquoted; never a `name:` in the body.
function frontmatterName(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  return /^name:[ \t]*([^\r\n]+)$/m.exec(block)?.[1].trim().replace(/^['"]|['"]$/g, '');
}

// A file of a git-subdir entry, upstream at the pinned sha; null for a local plugin.
const upstreamUrl = (plugin, kind, repoPath) => (typeof plugin.source === 'object'
  ? `${plugin.source.url}/${kind}/${plugin.source.sha}/${repoPath}`
  : null);

const posix = (relative) => relative.split(path.sep).join('/');

function validateSkillDirectories(skillsRoot) {
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!skill.isDirectory()) throw new Error(`unexpected entry in skills/: ${skill.name}`);
    const root = path.join(skillsRoot, skill.name);
    const walk = (dir) => {
      for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, child.name);
        if (child.isSymbolicLink()) throw new Error(`${file}: generated package contains symlink`);
        if (child.isDirectory()) walk(file);
      }
    };
    walk(root);
    const file = path.join(root, 'SKILL.md');
    if (!fs.existsSync(file)) throw new Error(`${skill.name}: missing SKILL.md`);
    const text = fs.readFileSync(file, 'utf8');
    const name = frontmatterName(text);
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      throw new Error(`${skill.name}: invalid skill name ${name || '(missing)'}`);
    }
    if (name !== skill.name) throw new Error(`${skill.name}: directory does not match skill name ${name}`);
    if (!/^description:[ \t]*(?:\S.*|[>|])[ \t]*$/m.test(text)) throw new Error(`${skill.name}: missing skill description`);
  }
}

function addProvenance(entry, plugin, destination, sourcePath, transformation) {
  const licence = fs.readdirSync(entry.repoRoot).find((name) => /^(LICEN[SC]E|COPYING)(\..*)?$/i.test(name));
  if (licence && !fs.existsSync(path.join(destination, licence))) fs.copyFileSync(path.join(entry.repoRoot, licence), path.join(destination, licence));
  if (fs.existsSync(path.join(destination, 'SOURCE.md'))) return;
  const upstream = upstreamUrl(plugin, 'tree', sourcePath) ?? sourcePath;
  fs.writeFileSync(path.join(destination, 'SOURCE.md'), [
    '# Source', '',
    `- **Source**: ${upstream}`,
    `- **Catalog entry**: \`${entry.name}\``,
    `- **Transformation**: ${transformation}`,
    '',
  ].join('\n'));
}

const convertedSkillName = (entry, artifact) => `${entry.name}-${path.basename(artifact.path, path.extname(artifact.path))}`;

// A converted skill lands in skills/<name>/, not next to its source, so a relative link
// upstream wrote from commands/ or agents/ no longer resolves. Point it at the sibling
// skill the same entry ships, or else at the file upstream; leave anything else alone.
// Inline links (bare, <bracketed> or titled) and reference definitions are rewritten;
// fenced code is not, since a path there is an example, not a link.
function rewriteRelativeLinks(body, sourceFile, entry, plugin) {
  const siblings = new Map((entry.artifacts || []).filter((item) => item.kind === 'skill').map((item) => {
    const dir = path.dirname(path.join(entry.sourceRoot, item.path));
    return [dir, frontmatterName(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))];
  }));
  const repoint = (target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('#')) return null;
    const [file, anchor = ''] = target.split(/(?=#)/);
    let resolved;
    try {
      resolved = path.resolve(path.dirname(sourceFile), decodeURIComponent(file));
    } catch {
      return null;
    }
    if (!resolved.startsWith(entry.sourceRoot + path.sep) || !fs.existsSync(resolved)) return null;
    for (const [dir, name] of siblings) {
      if (name && resolved.startsWith(dir + path.sep)) return `../${name}/${encodeURI(posix(path.relative(dir, resolved)))}${anchor}`;
    }
    const url = upstreamUrl(plugin, 'blob', posix(path.relative(entry.repoRoot, resolved)));
    return url && `${encodeURI(url)}${anchor}`;
  };
  return body.split(/^(```[\s\S]*?^```)/m).map((part, i) => (i % 2 ? part : part
    .replace(/(\]\(\s*)(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\s*\))/g, (match, open, raw, close) => {
      const angled = raw.startsWith('<');
      const target = repoint(angled ? raw.slice(1, -1) : raw);
      return target ? `${open}${angled ? `<${target}>` : target}${close}` : match;
    })
    .replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(\S+)/gm, (match, open, raw) => {
      const target = repoint(raw);
      return target ? `${open}${target}` : match;
    }))).join('');
}

function writeConvertedSkill(entry, plugin, artifact, destination) {
  const source = path.join(entry.sourceRoot, artifact.path);
  const text = fs.readFileSync(source, 'utf8');
  const description = /^description:[ \t]*(.*)$/m.exec(text)?.[1].trim().replace(/^['"]|['"]$/g, '') ||
    `${artifact.kind === 'agent' ? 'Run' : 'Execute'} the ${path.basename(artifact.path, path.extname(artifact.path))} workflow from ${entry.name}.`;
  const name = convertedSkillName(entry, artifact);
  const body = rewriteRelativeLinks(text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), source, entry, plugin);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`);
  addProvenance(entry, plugin, destination, artifact.path, `Converted ${artifact.kind} to a deterministic namespaced Agent Skill; relative links repointed at sibling skills or the upstream file.`);
  return name;
}

module.exports = { addProvenance, convertedSkillName, copySelfContained, validateSkillDirectories, writeConvertedSkill };
