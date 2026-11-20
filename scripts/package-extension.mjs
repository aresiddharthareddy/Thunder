import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('ide/extension');
const modelDir = path.join(root, 'models');
await rm(modelDir, { recursive: true, force: true });
await mkdir(modelDir, { recursive: true });
await cp(path.resolve('.thunder-build/qwen-1.5b.gguf.partial'), path.join(modelDir, 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf'));
console.log('Packaged local model into', modelDir);
