import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyFile } from '../ide/extension/models.mjs';
import { prepareCpuRuntime } from './build-cpu-runtime.mjs';
import { parseLicenseIssuer } from '../ide/extension/license.cjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const build=path.join(root,'.thunder-build');
const base=path.join(build,'codium','VSCodium.app');
const out=path.join(root,'release','Thunder Workbench.app');
const src=path.join(root,'ide','extension');
const manifest=JSON.parse(await fs.readFile(path.join(root,'resources/models.json')));
const starterPack = ['qwen2.5-coder-0.5b-q4', 'qwen2.5-coder-1.5b-q4'].map(id => {
  const model = manifest.models.find(entry => entry.id === id);
  if (!model) throw new Error(`Missing Auto pack entry: ${id}`);
  return model;
});
for (const model of starterPack) await verifyFile(path.join(src,'models',model.file),model);
await fs.access(base);
await fs.mkdir(path.dirname(out),{recursive:true});
const temp=await fs.mkdtemp(path.join('/private/tmp/','thunder-workbench-'));
const app=path.join(temp,'Thunder Workbench.app');
const resources=path.join(app,'Contents','Resources','app');
const ext=path.join(resources,'extensions','thunder-local');
try {
  await fs.mkdir(app,{recursive:true});
  execFileSync('rsync',['-a',`${base}/`,`${app}/`]);
  await fs.mkdir(ext,{recursive:true});
  for(const name of ['package.json','extension.cjs','panel.cjs','context.cjs','services.cjs','license.cjs','changes.cjs','auto.cjs','models.mjs','engine.mjs','cpu.mjs','bolt.svg','node_modules'])
    await fs.cp(path.join(src,name),path.join(ext,name),{recursive:true,verbatimSymlinks:true});
  if (process.env.THUNDER_LICENSE_PUBLIC_KEY_FILE) {
    const issuer = parseLicenseIssuer(await fs.readFile(process.env.THUNDER_LICENSE_PUBLIC_KEY_FILE, 'utf8'));
    await fs.writeFile(path.join(ext, 'license-public.pem'), issuer.export({type:'spki',format:'pem'}));
  }
  await prepareCpuRuntime(root,path.join(ext,'runtime'));
  await fs.copyFile(path.join(root,'resources/models.json'),path.join(ext,'catalog.json'));
  await fs.mkdir(path.join(ext,'models'));
  for(const model of starterPack)
    await fs.copyFile(path.join(src,'models',model.file),path.join(ext,'models',model.file));
  await fs.copyFile(path.join(build,'Qwen-LICENSE'),path.join(ext,'models','LICENSE'));
  if(process.argv.includes('--demo')) await fs.copyFile(path.join(build,'demo-public.pem'),path.join(ext,'demo-public.pem'));
  const productFile=path.join(resources,'product.json');
  const product=JSON.parse(await fs.readFile(productFile));
  Object.assign(product,{nameShort:'Thunder Workbench',nameLong:'Thunder Workbench',applicationName:'thunder-workbench',dataFolderName:'.thunder-workbench',urlProtocol:'thunder-workbench'});
  // VSCodium uses these IDs during renderer initialization even with its AI UI disabled.
  if (!product.defaultChatAgent?.chatExtensionId) throw new Error('The VSCodium base lacks required chat metadata.');
  for (const key of Object.keys(product.defaultChatAgent)) {
    if (key.endsWith('Url')) delete product.defaultChatAgent[key];
  }
  product.builtInExtensionsEnabledWithAutoUpdates = [];
  product.enableTelemetry = false;
  for(const key of ['updateUrl','extensionsGallery']) delete product[key];
  await fs.writeFile(productFile,JSON.stringify(product,null,2));
  const info=path.join(app,'Contents','Info.plist');
  // Keep the upstream internal name and helper paths paired for Electron's child process lookup.
  for(const [key,value] of Object.entries({CFBundleDisplayName:'Thunder Workbench',CFBundleIdentifier:'dev.thunder.workbench'}))
    execFileSync('plutil',['-replace',key,'-string',value,info]);
  execFileSync('xattr',['-cr',app]);
  execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
  execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
  if (process.argv.includes('--archive')) {
    // Stream the ZIP from the signed staging bundle before launch or file providers
    // can attach metadata to the copy in the Desktop workspace.
    const { version } = JSON.parse(await fs.readFile(path.join(ext,'package.json'),'utf8'));
    const file = `Thunder-Workbench-${version}-macos-${process.arch}.zip`;
    const stagedArchive = path.join(temp,file);
    execFileSync('/usr/bin/ditto',['-c','-k','--keepParent','--norsrc','--noextattr',app,stagedArchive],{stdio:'inherit'});
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(stagedArchive)) hash.update(chunk);
    const checksum = `${hash.digest('hex')}  ${file}\n`;
    const destination = path.join(path.dirname(out),file);
    await fs.rename(stagedArchive,destination);
    await fs.writeFile(destination+'.sha256',checksum);
    console.log(destination);
  } else {
    const previous=await fs.stat(out).catch(()=>null);
    const backup=path.join(temp,'previous.app');
    if(previous) await fs.rename(out,backup);
    try { await fs.rename(app,out); } catch(e) { if(previous) await fs.rename(backup,out);throw e; }
    console.log(out);
  }
  await fs.rm(temp,{recursive:true,force:true});
} catch(e){ console.error('Staged bundle:',temp);throw e; }
