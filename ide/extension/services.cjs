const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { hardware, inventory, fitsHardware, autoPack } = require('./auto.cjs');
const { DEFAULT_LICENSE_PUBLIC_KEY, verifyLicense } = require('./license.cjs');
const scrypt = promisify(crypto.scrypt);
const LICENSE_SECRET = 'pro-license';

class Services {
  constructor(ctx, onEntitlementChange = () => {}) {
    this.ctx = ctx;
    this.hw = hardware();
    this.user = 'Guest';
    this.sessionVersion = 0;
    this.onEntitlementChange = onEntitlementChange;
  }
  get state() { return this.ctx.globalState; }
  get pro() { return this.demoRole === 'admin' || (!this.demoRole && this.license?.expiresAt > Date.now()); }
  get profileScope() {
    if (this.demoRole) return 'demo:' + this.user;
    if (this.pro) return 'license:' + this.license.email.toLowerCase();
    return 'guest';
  }
  get dir() { return this.state.get('modelFolder',path.join(this.ctx.globalStorageUri.fsPath,'models')); }
  get offline() { return vscode.workspace.getConfiguration('thunder').get('zeroOutbound',true); }
  get policy() { return this.state.get('policy',{}); }
  get tuning() { return this.pro ? this.state.get('tuning',{}) : {}; }
  models() { return inventory(this.ctx.extensionPath,this.dir,this.policy.allowed,this.pro); }
  async init() {
    const version = this.sessionVersion;
    const [user, stored] = await Promise.all([
      this.ctx.secrets.get('demo-session'),
      this.ctx.secrets.get(LICENSE_SECRET),
    ]);
    const [accounts, license] = await Promise.all([
      user ? this.accounts() : [],
      stored ? this.readLicense(stored).catch(() => undefined) : undefined,
    ]);
    if (version !== this.sessionVersion) return;
    const demoAccount = accounts.find(account => account.user === user);
    this.user = demoAccount?.user || 'Guest';
    this.demoRole = demoAccount?.role;
    this.license = license;
    this.storedLicense = Boolean(stored);
    this.scheduleExpiry();
  }
  async readLicense(value) {
    let key;
    try {
      key = await fs.readFile(path.join(this.ctx.extensionPath, 'license-public.pem'), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      key = DEFAULT_LICENSE_PUBLIC_KEY;
    }
    return verifyLicense(value, key);
  }
  scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.license) return;
    const remaining = this.license.expiresAt - Date.now();
    if (remaining <= 0) {
      this.license = undefined;
      this.onEntitlementChange();
      return;
    }
    this.expiryTimer = setTimeout(() => this.scheduleExpiry(), Math.min(remaining, 2 ** 31 - 1));
    this.expiryTimer.unref();
  }
  async activateLicense(value) {
    if (this.demoRole) throw new Error('Sign out of the demo account to manage a subscription.');
    if (typeof value !== 'string') throw new Error('Enter a valid Thunder license key.');
    const key = value.trim();
    const license = await this.readLicense(key);
    this.sessionVersion++;
    await this.ctx.secrets.store(LICENSE_SECRET, key);
    this.license = license;
    this.storedLicense = true;
    this.scheduleExpiry();
  }
  async removeLicense() {
    if (this.demoRole) throw new Error('Sign out of the demo account to manage a subscription.');
    this.sessionVersion++;
    await this.ctx.secrets.delete(LICENSE_SECRET);
    this.license = undefined;
    this.storedLicense = false;
    this.scheduleExpiry();
  }
  dispose() {
    this.sessionVersion++;
    clearTimeout(this.expiryTimer);
    this.download?.abort();
  }
  async accounts() {
    try {
      const key=await fs.readFile(path.join(this.ctx.extensionPath,'demo-public.pem'),'utf8');
      const record=JSON.parse(await fs.readFile(path.join(this.ctx.globalStorageUri.fsPath,'demo-accounts.json'),'utf8'));
      return crypto.verify(null,Buffer.from(JSON.stringify(record.users)),key,Buffer.from(record.signature,'base64')) ? record.users : [];
    }
    catch { return []; }
  }
  async restore(user, version = this.sessionVersion) {
    const row = (await this.accounts()).find(a => a.user === user);
    if (version !== this.sessionVersion) return;
    this.user = row?.user || 'Guest';
    this.demoRole = row?.role;
  }
  async account() {
    const users = await this.accounts();
    const choices = users.map(account => account.user);
    if (this.demoRole) {
      choices.push('Sign out');
    } else {
      choices.push('Activate Pro license');
      if (this.storedLicense) choices.push('Remove local license');
    }
    const title = !this.demoRole && this.pro
      ? 'Thunder Pro · ' + this.license.plan + ' · expires ' + new Date(this.license.expiresAt).toLocaleDateString()
      : 'Thunder account';
    const pick = await vscode.window.showQuickPick(choices,{title});
    if (!pick) return;
    if (pick === 'Activate Pro license') {
      const key = await vscode.window.showInputBox({title:'Thunder Pro license',password:true,ignoreFocusOut:true});
      if (key === undefined) return;
      await this.activateLicense(key);
      return true;
    }
    if (pick === 'Remove local license') {
      await this.removeLicense();
      return true;
    }
    if (pick === 'Sign out') {
      this.sessionVersion++;
      await this.ctx.secrets.delete('demo-session');
      this.user = 'Guest';
      this.demoRole = undefined;
      return true;
    }
    const password = await vscode.window.showInputBox({title:'Sign in as '+pick,password:true,ignoreFocusOut:true});
    if (password === undefined) return;
    const account = users.find(a=>a.user===pick);
    const key = await scrypt(password, account.salt, 64);
    if (!crypto.timingSafeEqual(key,Buffer.from(account.hash,'hex'))) throw new Error('Incorrect password.');
    this.sessionVersion++;
    await this.ctx.secrets.store('demo-session',pick);
    await this.restore(pick);
    return true;
  }
  async folder() {
    if (this.preparing) throw new Error('Pause or dismiss the current download first.');
    const folder = await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'Store model pack here'});
    if (folder) await this.state.update('modelFolder',folder[0].fsPath);
  }
  async hydrate(selection) {
    if (this.download) { this.download.abort(); return; }
    if (this.preparing) return;
    this.preparing = true;
    try {
      const directory = this.dir;
      const models = await this.models();
      const pack = selection && this.pro ? models.filter(m=>m.id===selection && fitsHardware(m,this.hw)) : autoPack(models,this.hw);
      const missing = pack.filter(m=>!m.location);
      if (!pack.length) throw new Error('There are no compatible models allowed by the local policy.');
      if (!missing.length) return await vscode.window.showInformationMessage('Your local model pack is ready.');
      if (this.offline) throw new Error('Turn off Zero Outbound to download the missing Auto pack components.');
      const bytes = missing.reduce((n,m)=>n+m.sizeBytes,0);
      const answer = await vscode.window.showInformationMessage(
        'Download '+missing.length+' model component(s) · up to '+(bytes/1e9).toFixed(2)+' GB?',
        {modal:true,detail:directory},'Download');
      if (answer !== 'Download') return;
      if (this.offline) throw new Error('Zero Outbound was enabled while waiting for approval.');
      const controller = this.download = new AbortController();
      const {installModel} = await import('./models.mjs');
      await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Preparing Thunder Auto',cancellable:true},async (progress,cancel)=>{
        const listener = cancel.onCancellationRequested(()=>controller.abort());
        try { for (const [i,m] of missing.entries()) await installModel(m,directory,{signal:controller.signal,offline:()=>this.offline,progress:f=>progress.report({message:(i+1)+'/'+missing.length+' · '+Math.floor(f*100)+'%'})}); }
        finally { listener.dispose(); }
      });
    } finally {
      this.download=null;
      this.preparing=false;
    }
  }
  async lab() {
    if (!this.pro) return this.hydrate();
    const models = await this.models();
    const pick = await vscode.window.showQuickPick(models.map(m=>({label:m.displayName,description:(m.location?'Installed':'Download')+' · '+(m.sizeBytes/1e9).toFixed(1)+' GB',
      detail:'RAM fit '+Math.round(100*Math.max(0,1-m.sizeBytes/(os.totalmem()*.65)))+'/100 · '+m.contextLength+' model context · '+(this.state.get('rate:'+m.id) || 'Speed unmeasured'),m})),{title:'Model Lab'});
    if (!pick) return;
    if (!fitsHardware(pick.m,this.hw)) throw new Error('This model exceeds the local memory budget.');
    if (!this.pro) throw new Error('Your Pro license expired.');
    if (!pick.m.location) return this.hydrate(pick.m.id);
    const action = await vscode.window.showQuickPick(['Pin for Ask','Pin for Plan','Pin for Agent','Reset all to Auto'],{title:pick.label});
    if (action && !this.pro) throw new Error('Your Pro license expired.');
    if (action === 'Reset all to Auto') await this.state.update('pins',{});
    else if (action) await this.state.update('pins',{...this.state.get('pins',{}),[action.split(' ').at(-1).toLowerCase()]:pick.m.id});
  }
  async tune() {
    if (!this.pro) throw new Error('Sign in to Thunder Pro to tune inference.');
    const t = {...this.tuning};
    const key = await vscode.window.showQuickPick(['Context window','GPU layers','Quantized KV cache','N-gram decoding']);
    if (!key) return;
    const choices = {'Context window':['2048','4096','8192'],'GPU layers':['auto','0','8','16','32'],'Quantized KV cache':['Off','On'],'N-gram decoding':['Off','On']};
    const value = await vscode.window.showQuickPick(choices[key],{title:key});
    if (!value) return;
    if (!this.pro) throw new Error('Your Pro license expired.');
    if (key==='Context window') t.contextSize=Number(value);
    if (key==='GPU layers') t.gpuLayers=value==='auto'?'auto':Number(value);
    if (key==='Quantized KV cache') t.compactKV=value==='On';
    if (key==='N-gram decoding') t.lookup=value==='On';
    await this.state.update('tuning',t);
  }
  async team() {
    if (!this.pro) throw new Error('Team policy requires an administrator.');
    const all = await inventory(this.ctx.extensionPath,this.dir,undefined,true);
    const picked = await vscode.window.showQuickPick(all.map(m=>({label:m.displayName,id:m.id,picked:!this.policy.allowed||this.policy.allowed.includes(m.id)})),{title:'Approved models on this machine',canPickMany:true});
    if (picked && !this.pro) throw new Error('Your Pro license expired.');
    if (picked) await this.state.update('policy',{...this.policy,allowed:picked.map(x=>x.id)});
  }
  async audit(event,details) {
    this.auditTail = (this.auditTail || Promise.resolve()).catch(()=>{}).then(()=>this.state.update('audit',[...this.state.get('audit',[]),{time:new Date().toISOString(),user:this.user,event,...details}].slice(-250)));
    return this.auditTail;
  }
  async doctor() {
    const gpu = await require('systeminformation').graphics().catch(()=>({controllers:[]}));
    const report = { product:'Thunder', version:this.ctx.extension.packageJSON.version, tier:this.hw.tier,ramGB:this.hw.gb,platform:process.platform,arch:process.arch,
      graphics:gpu.controllers.map(g=>({device:g.model,driver:g.driverVersion})),localInference:'in-process',offline:this.offline,modelFolder:this.dir,
      models:(await this.models()).map(m=>({component:this.pro?m.id:'Auto',installed:!!m.location})), logs:this.ctx.logUri.fsPath, ...(this.pro?{events:this.state.get('audit',[])}:{}) };
    const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(report,null,2)});
    await vscode.window.showTextDocument(doc);
    if(this.pro && await vscode.window.showInformationMessage('Export this local diagnostic bundle?','Export')==='Export'){
      const dest=await vscode.window.showSaveDialog({filters:{JSON:['json']},saveLabel:'Export diagnostics'});
      if(dest && this.pro) await vscode.workspace.fs.writeFile(dest,Buffer.from(doc.getText()));
    }
  }
  async cloud(input, signal) {
    if (!this.pro || this.offline) throw new Error('Cloud reasoning requires Pro and Zero Outbound switched off.');
    const secret = this.demoRole === 'admin' ? 'openrouter' :
      'openrouter:license:' + crypto.createHash('sha256').update(this.license.email.toLowerCase()).digest('hex');
    const model=await vscode.window.showInputBox({title:'OpenRouter model ID',value:this.state.get('cloudModel','')});
    if (!model) return;
    let key=await this.ctx.secrets.get(secret);
    if (!key) {
      key=await vscode.window.showInputBox({title:'OpenRouter API key',password:true,ignoreFocusOut:true});
      if (!key) return;
      await this.ctx.secrets.store(secret,key);
    }
    const ok=await vscode.window.showWarningMessage('Send this prompt to OpenRouter?',{modal:true,detail:input},'Send once');
    if(ok!=='Send once') return;
    if (!this.pro || this.offline) throw new Error('Cloud access disabled.');
    await this.state.update('cloudModel',model);
    signal.throwIfAborted();
    if (!this.pro || this.offline) throw new Error('Cloud access disabled.');
    const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:input}],max_tokens:768})});
    if(!res.ok) throw new Error('OpenRouter returned HTTP '+res.status);
    return (await res.json()).choices?.[0]?.message?.content;
  }
}
module.exports = { Services };
