const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

function activate(context) {
  const provider = new AssistantViewProvider(context.extensionUri, context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('thunder.assistant', provider, { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('thunder.open', () => provider.reveal()));
  context.subscriptions.push(vscode.commands.registerCommand('thunder.models', () => vscode.window.showInformationMessage('Thunder models are managed from the Assistant panel.')));
  context.subscriptions.push(vscode.commands.registerCommand('thunder.doctor', async () => {
    const report = { generatedAt: Date.now(), version: '0.2.0', engine: 'node-llama-cpp 3.22.3', workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null };
    const uri = await vscode.window.showSaveDialog({ saveLabel: 'Export Thunder diagnostics', filters: { JSON: ['json'] }, defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(), 'thunder-diagnostic.json')) });
    if (uri) await fs.writeFile(uri.fsPath, JSON.stringify(report, null, 2));
  }));
}

class AssistantViewProvider {
  constructor(extensionUri, context) { this.extensionUri = extensionUri; this.context = context; this.view = null; this.engine = null; this.abort = null; }
  resolveWebviewView(view) { this.view = view; view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }; view.webview.html = html(); view.webview.onDidReceiveMessage((message) => this.handle(message)); }
  reveal() { this.view?.show?.(true); }
  async handle(message) {
    if (message.type === 'send') await this.send(message.text, message.mode);
    if (message.type === 'cancel') this.abort?.abort();
  }
  async send(text, mode) {
    if (!text?.trim()) return;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return this.post({ type: 'error', text: 'Open a workspace folder to use Thunder.' });
    const file = vscode.window.activeTextEditor?.document;
    let context = '';
    if (file) context = `<file path="${vscode.workspace.asRelativePath(file.uri)}">\n${file.getText().slice(0, 12000)}\n</file>`;
    const model = { id: 'qwen2.5-coder-1.5b-q4', repo: 'Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF', file: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf', revision: 'f86cb2c1fa58255f8052cc32aeede1b7482d4361', sizeBytes: 1117320768, sha256: 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046' };
    const modelFile = path.join(this.context.extensionPath, 'models', model.file);
    this.abort = new AbortController();
    try {
      if (!this.engine) { const { LocalEngine } = await import('./engine.mjs'); this.engine = new LocalEngine(); }
      this.post({ type: 'started' });
      const result = await this.engine.run({ mode: mode || 'ask', input: text, context, file: modelFile, model, signal: this.abort.signal, onText: (chunk) => this.post({ type: 'token', text: chunk }) });
      this.post({ type: 'done', text: result.text });
    } catch (error) { this.post({ type: 'error', text: error.name === 'AbortError' ? 'Cancelled.' : error.message }); }
    finally { this.abort = null; }
  }
  post(message) { this.view?.webview.postMessage(message); }
}

function html() { return `<!doctype html><html><head><meta charset="UTF-8"><style>
body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}h1{font-size:18px;margin:0 0 5px}.sub{opacity:.7;margin-bottom:16px}.messages{min-height:180px;max-height:calc(100vh - 170px);overflow:auto}.msg{padding:9px;border-radius:6px;margin:8px 0;white-space:pre-wrap}.user{background:var(--vscode-textBlockQuote-background)}.assistant{background:var(--vscode-editor-inactiveSelectionBackground)}textarea{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:8px;resize:vertical}button,select{margin-top:8px;padding:5px 9px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0}button+button{margin-left:6px}</style></head><body><h1>Thunder</h1><div class="sub">Private local coding assistant</div><div id="messages" class="messages"></div><textarea id="input" rows="4" placeholder="Ask about the open file..."></textarea><select id="mode"><option value="ask">Ask</option><option value="plan">Plan</option><option value="agent">Agent</option></select> <button id="send">Send</button><button id="cancel">Cancel</button><script>const api=acquireVsCodeApi(),root=document.getElementById('messages'),input=document.getElementById('input'),mode=document.getElementById('mode');let current=null;function add(text,cl){const el=document.createElement('div');el.className='msg '+cl;el.textContent=text;root.appendChild(el);root.scrollTop=root.scrollHeight;return el}document.getElementById('send').onclick=()=>{if(!input.value.trim())return;add(input.value,'user');current=add('','assistant');api.postMessage({type:'send',text:input.value,mode:mode.value});input.value=''};document.getElementById('cancel').onclick=()=>api.postMessage({type:'cancel'});window.addEventListener('message',e=>{const m=e.data;if(m.type==='token'&&current)current.textContent+=m.text;if(m.type==='done'&&current)current.dataset.done='true';if(m.type==='error')add(m.text,'assistant')});</script></body></html>`; }
module.exports = { activate, deactivate() {} };
