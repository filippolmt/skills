// Shared by guard.js and expansion.js: the hook's input and output, and a masked
// reading of a command that keeps only the text zsh itself expands.
const fs = require('fs');

// The Bash command of a PreToolUse payload, or null for anything else.
function readBashInput() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || '');
  if (input.tool_name !== 'Bash' || !command) return null;
  return { command: command, description: String(toolInput.description || '') };
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

// The delimiter of a heredoc opened at `at` (the first `<`), or null for the
// `<<<` here-string. Quotes and backslashes around the word are not part of it;
// any of them makes the body literal, otherwise zsh expands parameters in it.
function heredocAt(text, at) {
  const m = /^<<(-?)[ \t]*((?:'[^'\n]*'|"[^"\n]*"|\\.|[^\s;&|<>()])+)/.exec(text.slice(at));
  if (!m || text[at + 2] === '<') return null;
  return {
    delimiter: m[2].replace(/['"\\]/g, ''),
    stripTabs: m[1] === '-',
    expands: !/['"\\]/.test(m[2]),
  };
}

// Two views of the command, each the same length as it, so a position in one is
// a position in the command. Both blank what zsh does not expand: single-quoted
// text, a backslash-escaped character, a `#` comment, a heredoc body up to its
// terminator line. `words` also blanks double-quoted text, where neither word
// splitting, equals expansion nor globbing happens, except for a `$(…)` or
// backtick inside it, which is a shell of its own. `patterns` keeps
// double-quoted text, because `"${v/(x)/y}"` still matches a pattern, and the
// body of a heredoc with an unquoted delimiter, which zsh expands the same way:
// such a body reads like double-quoted text whose `"` is literal, with its
// `$(…)` and backticks a shell of their own in both views.
// A quote character becomes `_`, so `'a'b` stays one word.
function maskedViews(text, context) {
  let words = '';
  let patterns = '';
  const keep = (ch) => { words += ch; patterns += ch; };
  const blank = (ch) => keep(ch === '\n' ? '\n' : '_');
  // Each frame is a quoting context; `depth` counts open `(` inside a `$(…)`.
  const stack = [{ kind: context || 'plain', depth: 0 }];
  const pending = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    const prev = i ? text[i - 1] : '\n';
    if (top.kind === 'single') {
      blank(ch);
      if (ch === "'") stack.pop();
    } else if (top.kind === 'comment') {
      if (ch === '\n') { stack.pop(); i--; } else blank(ch);
    } else if (ch === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '\n') keep('  '); else blank('__');
      i++;
    } else if (top.kind === 'double' || top.kind === 'body') {
      if (ch === '"' && top.kind === 'double') { stack.pop(); words += '_'; patterns += ch; }
      else if (ch === '$' && text[i + 1] === '(') { keep('$('); i++; stack.push({ kind: 'subst', depth: 0 }); }
      else if (ch === '`') { keep(ch); stack.push({ kind: 'backtick', depth: 0 }); }
      else { words += ch === '\n' ? '\n' : '_'; patterns += ch; }
    } else if (ch === "'") {
      blank(ch); stack.push({ kind: 'single' });
    } else if (ch === '"') {
      words += '_'; patterns += ch; stack.push({ kind: 'double' });
    } else if (ch === '`' && top.kind === 'backtick') {
      keep(ch); stack.pop();
    } else if (ch === '#' && /\s/.test(prev)) {
      blank(ch); stack.push({ kind: 'comment' });
    } else if (ch === '$' && text[i + 1] === '(') {
      keep('$('); i++; stack.push({ kind: 'subst', depth: 0 });
    } else if (ch === '(') {
      keep(ch); top.depth++;
    } else if (ch === ')' && top.kind === 'subst' && top.depth === 0) {
      keep(ch); stack.pop();
    } else if (ch === ')') {
      keep(ch); top.depth = Math.max(0, top.depth - 1);
    } else if (ch === '<' && text[i + 1] === '<' && prev !== '<') {
      const heredoc = heredocAt(text, i);
      if (heredoc) pending.push(heredoc);
      keep(ch);
    } else if (ch === '\n' && pending.length) {
      keep(ch);
      // The bodies start on the next line, one after another, each ending on a
      // line that is exactly its delimiter.
      for (const { delimiter, stripTabs, expands } of pending.splice(0)) {
        // Every line up to the terminator, each with its newline, is body.
        let body = '';
        let terminator = '';
        for (let at = i + 1; ;) {
          const end = text.indexOf('\n', at);
          const line = text.slice(at, end === -1 ? text.length : end);
          if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) { terminator = line; break; }
          if (end === -1) { body += line; break; }
          body += line + '\n';
          at = end + 1;
        }
        const views = expands ? maskedViews(body, 'body') : null;
        if (views) { words += views.words; patterns += views.patterns; }
        else for (const c of body) blank(c);
        for (const c of terminator) blank(c);
        i += body.length + terminator.length;
      }
    } else {
      keep(ch);
    }
  }
  return { words: words, patterns: patterns };
}

module.exports = { readBashInput, deny, maskedViews };
