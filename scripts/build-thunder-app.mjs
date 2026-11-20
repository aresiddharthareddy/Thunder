import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyFile } from '../ide/extension/models.mjs';
import auto from '../ide/extension/auto.cjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const build=path.join(root,'.thunder-build');
const base=path.join(build,'codium','VSCodium.app');
const out=path.join(root,'release','Thunder Workbench.app');
const src=path.join(root,'ide','extension');
const manifest=JSON.parse(await fs.readFile(path.join(root,'resources/models.json')));
const starter=manifest.models.find(m=>m.id==='qwen2.5-coder-1.5b-q4');
await verifyFile(path.join(src,'models',starter.file),starter);
const hasNano=await fs.stat(path.join(src,'models',auto.nano.file)).catch(()=>null);
if(hasNano) await verifyFile(path.join(src,'models',auto.nano.file),auto.nano);
await fs.access(base);
await fs.mkdir(path.dirname(out),{recursive:true});
for (const entry of await fs.readdir(path.dirname(out))) if (entry.startsWith('workbench-build-')) await fs.rm(path.join(path.dirname(out),entry),{recursive:true,force:true});
const temp=await fs.mkdtemp(path.join('/private/tmp/','thunder-workbench-'));
const app=path.join(temp,'Thunder Workbench.app');
const resources=path.join(app,'Contents','Resources','app');
const ext=path.join(resources,'extensions','thunder-local');
try {
  await fs.mkdir(app,{recursive:true});
  execFileSync('rsync',['-a',`${base}/`,`${app}/`]);
  const frameworks=path.join(app,'Contents','Frameworks');
  for (const entry of await fs.readdir(frameworks)) {
    if (!entry.startsWith('VSCodium Helper')) continue;
    const suffix=entry.slice('VSCodium Helper'.length);
    const oldBundle=path.join(frameworks,entry);
    const newName='Thunder Workbench Helper'+suffix;
    const newBundle=path.join(frameworks,newName);
    await fs.rename(oldBundle,newBundle);
    const executableSuffix=suffix.replace(/\.app$/,'');
    const oldExecutable='VSCodium Helper'+executableSuffix;
    const newExecutable='Thunder Workbench Helper'+executableSuffix;
    const oldBinary=path.join(newBundle,'Contents','MacOS',oldExecutable);
    const newBinary=path.join(newBundle,'Contents','MacOS',newExecutable);
    await fs.rename(oldBinary,newBinary);
    const helperInfo=path.join(newBundle,'Contents','Info.plist');
    execFileSync('plutil',['-replace','CFBundleName','-string',newName,helperInfo]);
    execFileSync('plutil',['-insert','CFBundleExecutable','-string',newExecutable,helperInfo]);
  }
  await fs.mkdir(ext,{recursive:true});
  for(const name of ['package.json','extension.cjs','panel.cjs','context.cjs','services.cjs','changes.cjs','auto.cjs','models.mjs','engine.mjs','bolt.svg','node_modules'])
    await fs.cp(path.join(src,name),path.join(ext,name),{recursive:true,verbatimSymlinks:true});
  await fs.copyFile(path.join(root,'resources/models.json'),path.join(ext,'catalog.json'));
  await fs.mkdir(path.join(ext,'models'));
  for(const model of [starter,...(hasNano?[auto.nano]:[])])
    await fs.copyFile(path.join(src,'models',model.file),path.join(ext,'models',model.file));
  await fs.copyFile(path.join(build,'Qwen-LICENSE'),path.join(ext,'models','LICENSE'));
  if(process.argv.includes('--demo')) await fs.copyFile(path.join(build,'demo-public.pem'),path.join(ext,'demo-public.pem'));
  const productFile=path.join(resources,'product.json');
  const product=JSON.parse(await fs.readFile(productFile));
  Object.assign(product,{nameShort:'Thunder Workbench',nameLong:'Thunder Workbench',applicationName:'thunder-workbench',dataFolderName:'.thunder-workbench',urlProtocol:'thunder-workbench'});
  for(const key of ['defaultChatAgent','updateUrl','extensionsGallery','builtInExtensionsEnabledWithAutoUpdates']) delete product[key];
  await fs.writeFile(productFile,JSON.stringify(product,null,2));
  const info=path.join(app,'Contents','Info.plist');
  for(const [key,value] of Object.entries({CFBundleDisplayName:'Thunder Workbench',CFBundleName:'Thunder Workbench',CFBundleIdentifier:'dev.thunder.workbench'}))
    execFileSync('plutil',['-replace',key,'-string',value,info]);
  execFileSync('xattr',['-cr',app]);
  execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
  const previous=await fs.stat(out).catch(()=>null);
  const backup=path.join(temp,'previous.app');
  if(previous) await fs.rename(out,backup);
  try { await fs.rename(app,out); } catch(e) { if(previous) await fs.rename(backup,out);throw e; }
  if(previous) console.log('Previous build retained at',backup);
  else await fs.rm(temp,{recursive:true,force:true});
  console.log(out);
} catch(e){ console.error('Staged bundle:',temp);throw e; }
