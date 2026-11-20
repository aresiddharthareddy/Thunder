const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');

const nano = {
  id: 'qwen2.5-coder-0.5b-q4', displayName: 'Qwen2.5 Coder 0.5B',
  tier: 1, license: 'Apache-2.0', contextLength: 32768,
  repo: 'Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF',
  file: 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf',
  revision: 'ebb2015119c907b064c512bf053e945850b5875f',
  sizeBytes: 491400064, sha256: '1d9614638d18024d0fbb36575a15f1302a3adf044df10345688ec4f6e1c4ff32'
};

function hardware() {
  const gb = os.totalmem() / 2 ** 30;
  const apple = process.platform === 'darwin' && process.arch === 'arm64';
  const tier = apple && gb >= 16 ? 3 : apple && gb >= 8 ? 2.5 : gb >= 12 ? 2 : 1;
  return { tier, gb, files: tier === 3 ? 6 : tier === 2 ? 2 : 1 };
}

async function inventory(extension, directory, allowed) {
  let catalogPath=path.join(extension,'catalog.json');
  if (!await fs.stat(catalogPath).catch(()=>null)) catalogPath=path.resolve(extension,'../../resources/models.json');
  const manifest = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const catalog = [nano, ...manifest.models].filter(m => ['MIT','Apache-2.0'].includes(m.license));
  const result = [];
  for (const model of catalog) {
    if (allowed && !allowed.includes(model.id)) continue;
    let file;
    for (const dir of [directory, path.join(extension, 'models')]) {
      const candidate = path.join(dir, model.file);
      if ((await fs.stat(candidate).catch(() => null))?.size === model.sizeBytes) { file = candidate; break; }
    }
    result.push({ ...model, location: file });
  }
  return result.sort((a,b) => a.sizeBytes - b.sizeBytes);
}

function routes(models, hw, mode, input, pin) {
  const fit = models.filter(m => m.tier <= hw.tier && m.location);
  if (!fit.length) throw new Error('Prepare your Auto model pack to start local inference.');
  const pinned = pin && fit.find(m => m.id === pin);
  if (pinned) return [pinned];
  const complex = /\b(architect\w*|design|refactor|across|migrate|security|multiple|debug|why)\b/i.test(input) || input.length > 500;
  const small = fit[0];
  const coder = fit.find(m => m.sizeBytes >= 1e9) || small;
  const strong = fit.filter(m => m.sizeBytes <= hw.gb * 2 ** 30 * .45).at(-1) || coder;
  if (complex && strong !== small) return [small, strong];
  return [mode === 'ask' ? small : coder];
}

module.exports = { nano, hardware, inventory, routes };
