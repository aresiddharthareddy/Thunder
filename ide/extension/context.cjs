const path = require('node:path');
const fs = require('node:fs/promises');
const { safeName } = require('./changes.cjs');

const linked = text => [...text.matchAll(/(?:from\s+|require\(\s*|\[\[|\]\()(['"]?)([\w./-]+)\1/g)].map(m => path.basename(m[2]).toLowerCase());
const commonWords = new Set(['about', 'change', 'could', 'file', 'from', 'into', 'make', 'only', 'show', 'that', 'their', 'this', 'what', 'where', 'with', 'would']);

function keywords(input) {
  return [...new Set(input.toLowerCase().match(/[\w.-]{3,}/g) ?? [])].filter(word => !commonWords.has(word)).slice(0, 32);
}

function excerpt(source, terms, limit) {
  if (source.length <= limit) return source;
  const lines = source.split('\n');
  let bestLine = 0;
  let bestScore = 0;
  let bestColumn = 0;
  for (const [index, line] of lines.entries()) {
    const text = line.toLowerCase();
    const hits = terms.map(term => text.indexOf(term)).filter(column => column >= 0);
    if (hits.length > bestScore) {
      bestScore = hits.length;
      bestLine = index;
      bestColumn = Math.min(...hits);
    }
  }
  const leadingBudget = Math.floor(limit / 3);
  let firstLine = bestLine;
  let preceding = bestColumn;
  while (firstLine > Math.max(0, bestLine - 6) && preceding + lines[firstLine - 1].length < leadingBudget) {
    preceding += lines[--firstLine].length + 1;
  }
  const column = firstLine === bestLine ? Math.max(0, bestColumn - leadingBudget) : 0;
  const body = lines.slice(firstLine).join('\n').slice(column, column + limit - 36);
  return 'Excerpt starts on line ' + (firstLine + 1) + '\n' + body;
}

function composeContext(sources, input, maxChars) {
  const terms = keywords(input);
  let remaining = maxChars;
  const sections = [];
  for (const [file, { before }] of sources) {
    const header = 'File: ' + file + '\n';
    const available = Math.min(remaining - header.length, Math.floor(maxChars * (sections.length ? .32 : .65)));
    if (available < 180) break;
    const section = header + excerpt(before, terms, available);
    sections.push(section);
    remaining -= section.length + 2;
  }
  return sections.join('\n\n');
}

function redact(text) {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/\b(?:ghp_|github_pat_|sk-|AKIA|xox[baprs]-)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*)["']?[^\s"']{6,}["']?/gi,'$1[REDACTED]');
}
async function collect(input, signal, vscode) {
  const sources = new Map();
  if (!vscode.workspace.isTrusted) return sources;
  const active = vscode.window.activeTextEditor?.document;
  const folder = (active && vscode.workspace.getWorkspaceFolder(active.uri)) || vscode.workspace.workspaceFolders?.[0];
  if (folder?.uri.scheme !== 'file') return sources;
  const root = await fs.realpath(folder.uri.fsPath);
  const entries = await vscode.workspace.findFiles(new vscode.RelativePattern(folder,'**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,css,html,py,rs,go,java,txt}'), '**/{node_modules,dist,build,release,.git,.thunder-build}/**', 500);
  signal?.throwIfAborted();
  const words = keywords(input);
  const query = input.toLowerCase();
  const refs = active && vscode.workspace.getWorkspaceFolder(active.uri) === folder && safeName(vscode.workspace.asRelativePath(active.uri,false)) ? linked(active.getText().slice(0,8000)) : [];
  const candidates = [active?.uri,...entries].filter(uri => uri?.scheme === 'file');
  const ranked = candidates.map(uri => {
    const name = path.relative(folder.uri.fsPath,uri.fsPath).split(path.sep).join('/');
    const base = path.basename(name).toLowerCase();
    const score = (query.includes(name.toLowerCase()) ? 140 : query.includes(base) ? 120 : 0) +
      (uri.fsPath === active?.uri.fsPath ? 100 : 0) + words.filter(w => name.toLowerCase().includes(w)).length*10 +
      (refs.some(ref => base === ref || base.startsWith(ref+'.')) ? 6 : 0);
    return { uri,name,score };
  }).filter(c => safeName(c.name)).sort((a,b) => b.score - a.score);
  for (const { uri,name,score } of ranked) {
    signal?.throwIfAborted();
    if (sources.size >= 6 || (sources.size && !score)) break;
    if (sources.has(name)) continue;
    const actual = await fs.realpath(uri.fsPath).catch(() => '');
    if (actual !== path.join(root,name)) continue;
    const info = await fs.stat(actual).catch(() => null);
    if (!info?.isFile() || info.size > 96000) continue;
    const doc = await vscode.workspace.openTextDocument(uri).catch(() => null);
    if (!doc) continue;
    const before = doc.getText();
    if (before.length > 96000 || redact(before) !== before) continue;
    sources.set(name,{ uri,before,version:doc.version });
  }
  return sources;
}
module.exports = { collect, composeContext, redact };
