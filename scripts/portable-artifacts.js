const fs = require('fs');
const path = require('path');
const { posix } = require('./distribution.js');

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

// The `name` and `description` of a SKILL.md, from its YAML frontmatter. Both
// agents require both fields, so a skill missing either is not a skill we can
// vendor. Deliberately not a YAML parser: the two lines we need are flat.
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const field = (k) => {
    const f = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(m[1]);
    if (!f) return undefined;
    const v = f[1].trim().replace(/^['"]|['"]$/g, '');
    return v === '>' || v === '|' ? undefined : v;
  };
  return { name: field('name'), description: field('description') };
}

// A file of a git-subdir entry, upstream at the pinned sha; null for a local plugin.
const upstreamUrl = (plugin, kind, repoPath) => (typeof plugin.source === 'object'
  ? `${plugin.source.url}/${kind}/${plugin.source.sha}/${repoPath}`
  : null);

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
    const { name } = parseFrontmatter(text);
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
// Inline links (bare or <bracketed>, with or without a title) and reference
// definitions are rewritten; code, fenced or inline, is not: a path there is an
// example, not a link.
const encodePath = (relative) => relative.split('/').map(encodeURIComponent).join('/');
const INLINE_LINK = /(\]\(\s*)(<[^>\n]+>|[^)\s]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\))/g;
const REFERENCE = /^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function rewriteRelativeLinks(body, sourceFile, entry, plugin) {
  const siblings = new Map(entry.artifacts.filter((item) => item.kind === 'skill').map((item) => {
    const dir = path.dirname(path.join(entry.sourceRoot, item.path));
    return [dir, parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).name];
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
      if (!name || (resolved !== dir && !resolved.startsWith(dir + path.sep))) continue;
      return `../${name}/${encodePath(posix(path.relative(dir, resolved)))}${anchor}`;
    }
    const url = upstreamUrl(plugin, 'blob', encodePath(posix(path.relative(entry.repoRoot, resolved))));
    return url && `${url}${anchor}`;
  };
  const rewrite = (match, open, raw, close = '') => {
    const angled = raw.startsWith('<');
    const target = repoint(angled ? raw.slice(1, -1) : raw);
    return target ? `${open}${angled ? `<${target}>` : target}${close}` : match;
  };
  const prose = (text) => text.split(/(`+[^`\n]*`+)/).map((part, i) => (i % 2 ? part : part
    .replace(INLINE_LINK, rewrite)
    .replace(REFERENCE, (match, open, raw) => rewrite(match, open, raw)))).join('');

  // Line by line, so a fence opened by ``` or ~~~ (indented up to three spaces) closes
  // only on the same marker, as CommonMark has it.
  const out = [];
  let fence = null;
  let run = [];
  const flush = () => {
    if (run.length) out.push(prose(run.join('\n')));
    run = [];
  };
  for (const line of body.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      flush();
      out.push(line);
      fence = marker;
    } else {
      run.push(line);
    }
  }
  flush();
  return out.join('\n');
}

function writeConvertedSkill(entry, plugin, artifact, destination) {
  const source = path.join(entry.sourceRoot, artifact.path);
  const text = fs.readFileSync(source, 'utf8');
  const description = parseFrontmatter(text).description ||
    `${artifact.kind === 'agent' ? 'Run' : 'Execute'} the ${path.basename(artifact.path, path.extname(artifact.path))} workflow from ${entry.name}.`;
  const name = convertedSkillName(entry, artifact);
  const body = rewriteRelativeLinks(text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), source, entry, plugin);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`);
  addProvenance(entry, plugin, destination, artifact.path, `Converted ${artifact.kind} to a deterministic namespaced Agent Skill; relative links repointed at sibling skills or the upstream file.`);
  return name;
}

module.exports = { addProvenance, convertedSkillName, copySelfContained, parseFrontmatter, validateSkillDirectories, writeConvertedSkill };
