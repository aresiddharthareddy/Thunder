const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const { Services } = require('./services.cjs');
const { collect, composeContext, redact } = require('./context.cjs');
const { autoPack, planRoute } = require('./auto.cjs');
const { stage } = require('./changes.cjs');
const { panel } = require('./panel.cjs');

class Assistant {
  constructor(ctx) {
    this.ctx=ctx;
    this.services=new Services(ctx,()=>this.status());
    this.previews=new Map();
  }
  historyKey() {
    const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath||'no-workspace';
    return 'memory:'+createHash('sha256').update(root+'\0'+this.services.profileScope).digest('hex').slice(0,24);
  }
  post(message) { return this.view?.webview.postMessage(message); }
  status() {
    const s=this.services;
    this.post({type:'state',user:s.user,pro:s.pro,tier:s.hw.tier,offline:s.offline,busy:!!this.run,
      review:this.pending?.batches[0]?.map(c=>c.file)||[],more:(this.pending?.batches.length||1)-1});
  }
  resolveWebviewView(view) {
    this.view=view;
    view.webview.options={enableScripts:true,localResourceRoots:[]};
    view.webview.onDidReceiveMessage(m=>this.dispatch(m));
    view.onDidDispose(()=>{this.run?.abort();this.clearReview();this.view=null;});
    view.webview.html=panel();
  }
  clearReview() { this.pending=null; this.previews.clear(); }
  async dispatch(m) {
    try {
      if (m.type==='cancel') return this.run?.abort();
      if (m.type==='ready') return this.status();
      if (m.type==='send') return await this.send(m);
      if (this.run || this.action) return;
      this.action=true;
      try {
        switch (m.type) {
          case 'review': await this.preview(m.file); break;
          case 'apply': await this.apply(); break;
          case 'reject': this.clearReview(); break;
          case 'account': if(await this.services.account()){this.clearReview();this.post({type:'clear'});} break;
          case 'memory': await this.ctx.globalState.update(this.historyKey(),[]); this.post({type:'clear'}); this.notice('Local context memory cleared.'); break;
          case 'lab': await this.services.lab(); break;
          case 'folder': await this.services.folder(); break;
          case 'tuning': await this.services.tune(); break;
          case 'team': await this.services.team(); break;
          case 'doctor': await this.services.doctor(); break;
          case 'network': await vscode.workspace.getConfiguration('thunder').update('zeroOutbound',!this.services.offline,vscode.ConfigurationTarget.Global); break;
          case 'terminal': await this.terminal(); break;
          case 'open': await vscode.commands.executeCommand('vscode.openFolder'); break;
          case 'pack': void this.services.hydrate().catch(e=>this.notice(e.name==='AbortError'?'Download paused.':e.message)); break;
        }
      } finally { this.action=false; }
    } catch(e) { this.notice(e.message); }
    finally { this.status(); }
  }
  notice(text) { this.post({type:'notice',text}); }
  async terminal() {
    if(!vscode.workspace.isTrusted) throw new Error('Trust the workspace before running a terminal command.');
    const folder=vscode.workspace.workspaceFolders?.[0];
    if(!folder) throw new Error('Open a folder first.');
    const cmd=await vscode.window.showInputBox({title:'Run a workspace command'});
    if(!cmd?.trim()) return;
    if(await vscode.window.showWarningMessage('Run this command once?',{modal:true,detail:folder.uri.fsPath+'\n'+cmd},'Run once')!=='Run once') return;
    const terminal=vscode.window.createTerminal({name:'Thunder',cwd:folder.uri});
    terminal.show(); terminal.sendText(cmd);
    await this.services.audit('terminal.approved',{});
  }
  async send({text,mode}) {
    if(this.run || this.action || typeof text!=='string' || !text.trim()) return;
    if(text.length>8000) throw new Error('Shorten the request to 8,000 characters.');
    if(!['ask','plan','agent','cloud'].includes(mode)) throw new Error('Choose a supported mode.');
    if(this.pending) throw new Error('Apply or discard the staged edits first.');
    const controller=this.run=new AbortController();
    const s=this.services;
    const deadline=mode==='cloud'?null:AbortSignal.timeout(s.hw.tier===1?60_000:120_000);
    const signal=deadline?AbortSignal.any([controller.signal,deadline]):controller.signal;
    const memoryKey=this.historyKey();
    const history=this.ctx.globalState.get(memoryKey,[]).slice(-4);
    this.post({type:'start',text}); this.status();
    let answer='';
    try {
      if (mode==='cloud') {
        answer=await s.cloud(redact(text),signal)||'Cloud request cancelled.';
      } else if (/\b(who are you|what (?:ai |language )?model (?:are you|is this)|(?:your|underlying|actual|real) (?:model|identity)|what are you powered by)\b/i.test(text)) {
        answer='I’m Thunder Agent, your local coding assistant.';
      } else {
        this.post({type:'phase',text:'Finding relevant workspace files…'});
        const sources=await collect(text,signal,vscode);
        signal.throwIfAborted();
        if(mode==='agent' && !sources.size) throw new Error('Open a trusted workspace folder and a source file to propose an edit.');
        const files=composeContext(sources,text,s.hw.tier===1?2600:5200);
        const route=planRoute(await s.models(),s.hw,{
          mode,input:text,pin:s.pro && s.state.get('pins',{})[mode],sourceCount:sources.size
        });
        this.engine ??= new (await import('./engine.mjs')).LocalEngine();
        const previous=history.join('\n').slice(-750);
        let notes=previous;
        let phases=0;
        const infer=async (model,phase,input,maxTokens,{onText,runSignal=signal}={})=>{
          runSignal.throwIfAborted();
          phases++;
          const result=await this.engine.run({
            mode:phase,input,context:files,history:notes,model,file:model.location,signal:runSignal,maxTokens,tuning:s.tuning,onText,
            onBackend:backend=>this.post({type:'phase',text:backend==='cpu-defaults'?'Running on CPU with default decoding…':'Running on CPU…'})
          });
          runSignal.throwIfAborted();
          if(result.elapsedMs>0 && result.usedOutputTokens>0) {
            await s.state.update('rate:'+model.id,Math.round(result.usedOutputTokens*1000/result.elapsedMs)+' tokens/s last run');
          }
          return result.text;
        };
        if(route.triage) {
          this.post({type:'phase',text:'Checking which files matter…'});
          try {
            const runSignal=AbortSignal.any([signal,AbortSignal.timeout(12_000)]);
            const hint=await infer(route.triage,'triage',text,64,{runSignal});
            notes=[previous,'Local context hint: '+redact(hint).slice(0,350)].filter(Boolean).join('\n');
          } catch {
            // The primary model still has the source excerpts if the optional pass fails.
            signal.throwIfAborted();
          }
        }
        this.post({type:'phase',text:mode==='agent'?'Preparing a diff…':'Composing…'});
        if(mode==='agent') {
          let request=text;
          for(let i=0;i<2;i++) {
            const selected=i===0?route.primary:route.retry;
            const maxTokens=i===0?route.maxTokens:Math.min(900,route.maxTokens+160);
            const proposal=await infer(selected,mode,request,maxTokens);
            signal.throwIfAborted();
            try { this.pending=stage(proposal,sources,s.hw.files); break; }
            catch(e) {
              if(i===1) throw new Error('Could not stage a valid edit. '+e.message);
              this.post({type:'phase',text:route.primary===route.retry?'Correcting the proposed edit…':'Giving the edit a deeper check…'});
              request=text+'\nCorrect the previous proposal: '+redact(e.message).slice(0,350);
            }
          }
          answer=this.pending.summary;
          await this.preview(this.pending.batches[0][0].file);
        } else answer=await infer(route.primary,mode,text,route.maxTokens,{onText:chunk=>this.post({type:'token',text:chunk})});
        await s.audit('inference',{mode,phases,files:sources.size});
      }
      await this.ctx.globalState.update(memoryKey,[...history,redact(text),redact(answer)].slice(-4));
      this.post({type:'end',text:answer});
    } catch(e) {
      const response=controller.signal.aborted?'Cancelled.':deadline?.aborted||e.name==='TimeoutError'
        ?'Local inference timed out. Try a smaller edit or run Thunder Doctor.':e.message;
      this.post({type:'end',text:response});
    }
    finally { this.run=null; this.status(); }
  }
  async preview(file) {
    const c=this.pending?.batches[0].find(item=>item.file===file);
    if(!c) return;
    const uri=vscode.Uri.from({scheme:'thunder-preview',path:'/'+c.file,query:randomUUID()});
    this.previews.set(uri.toString(),c.after);
    await vscode.commands.executeCommand('vscode.diff',c.uri,uri,'Thunder · '+c.file,{preview:true,preserveFocus:true});
  }
  async apply() {
    const batch=this.pending?.batches[0];
    if(!batch || !vscode.workspace.isTrusted) throw new Error('A reviewed edit in a trusted workspace is required.');
    const edit=new vscode.WorkspaceEdit();
    const saveCandidates=[];
    for(const c of batch) {
      const folder=vscode.workspace.getWorkspaceFolder(c.uri);
      if(!folder || await fs.realpath(c.uri.fsPath)!==path.join(await fs.realpath(folder.uri.fsPath),c.file)) throw new Error('The workspace path changed. Discard and regenerate the edit.');
      const doc=await vscode.workspace.openTextDocument(c.uri);
      if(doc.version!==c.version || doc.getText()!==c.before) throw new Error('File changed after review. Discard and regenerate the edit.');
      edit.replace(c.uri,new vscode.Range(doc.positionAt(0),doc.positionAt(c.before.length)),c.after);
      if(!doc.isDirty) saveCandidates.push({doc,after:c.after});
    }
    if(!await vscode.workspace.applyEdit(edit)) throw new Error('The workbench declined the edit.');
    this.pending.batches.shift();
    let saved=0;
    for(const {doc,after} of saveCandidates) {
      if(doc.getText()===after && await doc.save().catch(()=>false)) saved++;
    }
    if(this.pending.batches.length) await this.preview(this.pending.batches[0][0].file);
    else this.clearReview();
    const detail=saved===batch.length?'Saved to disk.':`Saved ${saved} of ${batch.length}. Remaining changes are in the editor.`;
    this.notice('Applied to '+batch.map(c=>c.file).join(', ')+'. '+detail);
    await this.services.audit('agent.apply',{count:batch.length,saved});
  }
}
let assistant;
async function activate(ctx) {
  assistant=new Assistant(ctx);
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('thunder.assistant',assistant,{webviewOptions:{retainContextWhenHidden:true}}),
    vscode.workspace.registerTextDocumentContentProvider('thunder-preview',{provideTextDocumentContent:uri=>assistant.previews.get(uri.toString())??''}),
    vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('thunder.zeroOutbound') && assistant.services.offline){assistant.services.download?.abort();assistant.run?.abort();}assistant.status();}));
  const focus=()=>vscode.commands.executeCommand('workbench.view.extension.thunder');
  const commands={open:focus,models:()=>assistant.dispatch({type:'lab'}),doctor:()=>assistant.dispatch({type:'doctor'}),account:()=>assistant.dispatch({type:'account'})};
  for(const [name,handler] of Object.entries(commands)) ctx.subscriptions.push(vscode.commands.registerCommand('thunder.'+name,handler));
  // Keep the primary Thunder surface visible after restarts, including an existing demo profile.
  void focus().catch(()=>undefined);
  void assistant.services.init().then(()=>assistant.status(),()=>assistant.notice('Account storage is unavailable. Local Free mode is ready.'));
  if (!ctx.globalState.get('welcomed') && ctx.extensionMode!==vscode.ExtensionMode.Test) {
    await ctx.globalState.update('welcomed',true);
    const pack=autoPack(await assistant.services.models(),assistant.services.hw);
    if(!assistant.services.offline && pack.some(m=>!m.location)) void assistant.services.hydrate().catch(e=>assistant.notice(e.message));
  }
}
async function deactivate(){ assistant?.run?.abort(); assistant?.services.dispose(); await assistant?.engine?.dispose(); }
module.exports={activate,deactivate,Assistant};
