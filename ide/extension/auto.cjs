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

async function inventory(extension, directory, allowed, includeRestricted = false) {
  let catalogPath=path.join(extension,'catalog.json');
  if (!await fs.stat(catalogPath).catch(()=>null)) catalogPath=path.resolve(extension,'../../resources/models.json');
  const manifest = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const catalog = [...new Map([nano, ...manifest.models].map(m => [m.id, m])).values()].filter(m => includeRestricted || ['MIT','Apache-2.0'].includes(m.license));
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

function fitsHardware(model, hw) {
  return model.tier <= hw.tier && model.sizeBytes <= hw.gb * 2 ** 30 * 0.45;
}

function autoPack(models, hw) {
  return models.filter(model => fitsHardware(model, hw) && ['MIT', 'Apache-2.0'].includes(model.license) &&
    (model.sizeBytes <= 2e9 || (hw.gb >= 16 && model.sizeBytes <= 5e9)));
}

function planRoute(models, hw, { mode, input, pin, sourceCount }) {
  const fit = models.filter(model => model.location && fitsHardware(model, hw)).sort((a, b) => a.sizeBytes - b.sizeBytes);
  if (!fit.length) throw new Error('Prepare your Auto model pack to start local inference.');
  const complex = input.length > 600 ||
    /\b(?:architect\w*|migrat\w*|race condition|regression|compatib\w*)\b/i.test(input) ||
    (sourceCount > 1 && /\b(?:across|multi[- ]file|refactor|trace|compare)\b/i.test(input));
  const maxTokens = mode === 'agent' ? (complex ? 900 : 480) : mode === 'plan' ? (complex ? 640 : 352) : (complex ? 512 : 256);
  const pinned = pin && fit.find(model => model.id === pin);
  if (pinned) return { primary: pinned, retry: pinned, maxTokens };
  const nanoModel = fit[0];
  const coder = fit.find(model => model.sizeBytes >= 1e9) ?? nanoModel;
  const strongest = fit.at(-1);
  const primary = hw.tier === 1 ? nanoModel : complex ? strongest : mode === 'ask' ? nanoModel : coder;
  const triage = complex && sourceCount > 1 && nanoModel.sizeBytes < 1e9 && primary !== nanoModel ? nanoModel : undefined;
  // Keep Tier 1 on a nano first. Upgrade a rejected edit only when the starter coder fits.
  const retry = (hw.tier === 1 ? coder : strongest).sizeBytes > primary.sizeBytes
    ? (hw.tier === 1 ? coder : strongest)
    : primary;
  return { primary, retry, triage, maxTokens };
}

module.exports = { nano, hardware, inventory, fitsHardware, autoPack, planRoute };
