const fs = require('node:fs');

const warningName = /^(?:warn|warning|warnings)$/i;
function warningData(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => {
    if (warningName.test(key)) {
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === 'object') return Object.keys(item).length > 0;
      return Boolean(item);
    }
    if (['method', 'level', 'severity'].includes(key) && typeof item === 'string' && warningName.test(item)) return true;
    return warningData(item);
  });
}

function hasWarning(output) {
  const text = String(output || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  try { return warningData(JSON.parse(text)); } catch {}
  return text.split(/\r?\n/).some((line) => {
    try { return warningData(JSON.parse(line)); } catch {}
    return /^\s*(?:\d{4}-\d\d-\d\d\S*\s+)?(?:\[warn(?:ing|ings)?\]|warn(?:ing|ings)?)(?:\s|:|$)/i.test(line);
  });
}

module.exports = { hasWarning };
if (require.main === module) {
  process.exit(hasWarning(fs.readFileSync(0, 'utf8')) ||
    process.argv.slice(2).some(file => hasWarning(fs.readFileSync(file, 'utf8'))) ? 1 : 0);
}
