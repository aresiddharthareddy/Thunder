const ts = require('typescript');
const path = require('node:path');

function safeName(name) {
  return typeof name === 'string' && name.length < 512 && !path.isAbsolute(name) &&
    !name.split(/[\\/]/).some(p => !p || p.startsWith('.') || /^(node_modules|dist|release|secrets?)$/i.test(p)) &&
    !/(?:creds|credential|private[_-]?key|password|secret|token)/i.test(name) &&
    /\.(?:[cm]?[jt]sx?|json|md|css|html|py|rs|go|java|txt)$/i.test(name);
}

function stage(text, sources, budget) {
  const plan = JSON.parse(text);
  if (!Array.isArray(plan.edits) || !plan.edits.length) throw new Error('No concrete edits were proposed.');
  if (plan.edits.length > 16) throw new Error('Too many replacements in one request.');
  const changes = new Map();
  for (const { file, search, replace } of plan.edits) {
    const src = sources.get(file);
    if (!safeName(file) || !src || typeof search !== 'string' || !search || typeof replace !== 'string')
      throw new Error('Use an exact replacement in a supplied file.');
    const original = changes.get(file)?.after ?? src.before;
    const i = original.indexOf(search);
    if (i < 0 || original.indexOf(search, i + 1) >= 0) throw new Error('Search must match exactly once in ' + file);
    changes.set(file, { ...src, file, after: original.slice(0,i) + replace + original.slice(i + search.length) });
  }
  const list = [...changes.values()].filter(c => c.before !== c.after);
  if (!list.length) throw new Error('The proposed edit leaves the file unchanged.');
  for (const c of list) {
    if (/\.[cm]?[jt]sx?$/i.test(c.file)) {
      const d = ts.createSourceFile(c.file, c.after, ts.ScriptTarget.Latest, false).parseDiagnostics[0];
      if (d) throw new Error(c.file + ': ' + ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    } else if (/\.json$/i.test(c.file)) JSON.parse(c.after);
  }
  return { summary: String(plan.summary || 'Proposed changes').slice(0,500), batches: Array.from({length: Math.ceil(list.length / budget)}, (_,i) => list.slice(i*budget,(i+1)*budget)) };
}
module.exports = { safeName, stage };
