const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { safeName } = require('./changes.cjs');

const linked = text => [...text.matchAll(/(?:from\s+|require\(\s*|\[\[|\]\()(['"]?)([\w./-]+)\1/g)].map(m => path.basename(m[2]).toLowerCase());
function redact(text) {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
    .replace(/\b(?:ghp_|github_pat_|sk-|AKIA|xox[baprs]-)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/((?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*)["']?[^\s"']{6,}["']?/gi,'$1[REDACTED]');
}
async function collect(input) {
  const sources = new Map();
  if (!vscode.workspace.isTrusted) return sources;
  const active = vscode.window.activeTextEditor?.document;
  const folder = (active && vscode.workspace.getWorkspaceFolder(active.uri)) || vscode.workspace.workspaceFolders?.[0];
  if (folder?.uri.scheme !== 'file') return sources;
  const root = await fs.realpath(folder.uri.fsPath);
  const entries = await vscode.workspace.findFiles(new vscode.RelativePattern(folder,'**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,css,html,py,rs,go,java,txt}'), '**/{node_modules,dist,build,release,.git,.thunder-build}/**', 500);
  const words = input.toLowerCase().match(/[\w.-]{3,}/g) || [];
  const refs = active && vscode.workspace.getWorkspaceFolder(active.uri) === folder && safeName(vscode.workspace.asRelativePath(active.uri,false)) ? linked(active.getText().slice(0,8000)) : [];
  const candidates = [active?.uri,...entries].filter(uri => uri?.scheme === 'file');
  const ranked = candidates.map(uri => {
    const name = path.relative(folder.uri.fsPath,uri.fsPath).split(path.sep).join('/');
    const base = path.basename(name).toLowerCase();
    const score = (uri.fsPath === active?.uri.fsPath ? 100 : 0) + words.filter(w => name.toLowerCase().includes(w)).length*10 +
      (refs.some(ref => base === ref || base.startsWith(ref+'.')) ? 6 : 0);
    return { uri,name,score };
  }).filter(c => safeName(c.name)).sort((a,b) => b.score - a.score);
  for (const { uri,name,score } of ranked) {
    if (sources.size >= 6 || (sources.size && !score)) break;
    if (sources.has(name)) continue;
    const actual = await fs.realpath(uri.fsPath).catch(() => '');
    if (actual !== path.join(root,name) || (await fs.stat(actual)).size > 96000) continue;
    const doc = await vscode.workspace.openTextDocument(uri);
    const before = doc.getText();
    if (before.length > 96000 || redact(before) !== before) continue;
    sources.set(name,{ uri,before,version:doc.version });
  }
  return sources;
}
module.exports = { collect, redact };
