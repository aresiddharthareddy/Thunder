// Accept two passwords on stdin, one per line. Only the verification key is bundled.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, randomBytes, scryptSync, sign } from 'node:crypto';
const build=path.resolve('.thunder-build');
const storage=path.join(build,'demo-profile','User','globalStorage','thunder.thunder-local');
let input='';
for await(const chunk of process.stdin) input+=chunk;
const passwords=input.trimEnd().split(/\r?\n/);
if(passwords.length!==2 || passwords.some(p=>p.length<8)) throw new Error('Two demo passwords required.');
const users=['admin','siddhartha'].map((user,i)=>{
  const salt=randomBytes(16).toString('hex');
  return {user,role:i===0?'admin':'free',salt,hash:scryptSync(passwords[i],salt,64).toString('hex')};
});
const pair=generateKeyPairSync('ed25519');
const signature=sign(null,Buffer.from(JSON.stringify(users)),pair.privateKey).toString('base64');
await fs.mkdir(storage,{recursive:true});
await fs.writeFile(path.join(storage,'demo-accounts.json'),JSON.stringify({users,signature}),{mode:0o600});
await fs.writeFile(path.join(build,'demo-public.pem'),pair.publicKey.export({type:'spki',format:'pem'}));
