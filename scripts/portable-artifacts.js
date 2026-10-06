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
    const name = /^name:[ \t]*([^\r\n]+)$/m.exec(text)?.[1].trim().replace(/^['"]|['"]$/g, '');
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
  const upstream = typeof plugin.source === 'object'
    ? `${plugin.source.url}/tree/${plugin.source.sha}/${sourcePath}`
    : sourcePath;
  fs.writeFileSync(path.join(destination, 'SOURCE.md'), [
    '# Source', '',
    `- **Source**: ${upstream}`,
    `- **Catalog entry**: \`${entry.name}\``,
    `- **Transformation**: ${transformation}`,
    '',
  ].join('\n'));
}

const convertedSkillName = (entry, artifact) => `${entry.name}-${path.basename(artifact.path, path.extname(artifact.path))}`;

function writeConvertedSkill(entry, plugin, artifact, destination) {
  const source = path.join(entry.sourceRoot, artifact.path);
  const text = fs.readFileSync(source, 'utf8');
  const description = /^description:[ \t]*(.*)$/m.exec(text)?.[1].trim().replace(/^['"]|['"]$/g, '') ||
    `${artifact.kind === 'agent' ? 'Run' : 'Execute'} the ${path.basename(artifact.path, path.extname(artifact.path))} workflow from ${entry.name}.`;
  const name = convertedSkillName(entry, artifact);
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`);
  addProvenance(entry, plugin, destination, artifact.path, `Converted ${artifact.kind} to a deterministic namespaced Agent Skill.`);
  return name;
}

module.exports = { addProvenance, convertedSkillName, copySelfContained, validateSkillDirectories, writeConvertedSkill };
