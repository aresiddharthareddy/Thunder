import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const bundle = process.argv.slice(2).find(argument => !argument.startsWith("--")) ?? "release/Thunder Workbench.app";
const extensionPath = path.resolve(bundle, "Contents/Resources/app/extensions/thunder-local");
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "thunder-agent-smoke-"));
const before = "export function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n";
const file = { scheme: "file", fsPath: path.join(workspace, "hello.ts") };
const folder = { uri: { scheme: "file", fsPath: workspace } };
const document = {
  uri: file, text: before, version: 1, isDirty: false,
  getText() { return this.text; },
  positionAt(offset) { return offset; },
  async save() { await fs.writeFile(file.fsPath, this.text); return true; }
};
const messages = [];
const previews = [];
const exerciseHandoff = process.argv.includes("--handoff");
const attempts = [];
const state = new Map();
const vscode = {
  ConfigurationTarget: { Global: 1 },
  Uri: { from: ({ scheme, path: uriPath, query }) => ({ toString: () => `${scheme}:${uriPath}?${query}` }) },
  RelativePattern: class {},
  Range: class { constructor(start, end) { Object.assign(this, { start, end }); } },
  WorkspaceEdit: class {
    edits = [];
    replace(uri, range, text) { this.edits.push({ uri, range, text }); }
  },
  window: { activeTextEditor: { document } },
  commands: { async executeCommand(name, original, preview) { previews.push({ name, original, preview }); } },
  workspace: {
    isTrusted: true,
    workspaceFolders: [folder],
    getWorkspaceFolder: () => folder,
    asRelativePath: () => "hello.ts",
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    async findFiles() { return [file]; },
    async openTextDocument() { return document; },
    async applyEdit(edit) {
      assert.equal(edit.edits.length, 1);
      const [change] = edit.edits;
      assert.equal(change.uri, file);
      assert.equal(change.range.start, 0);
      assert.equal(change.range.end, document.text.length);
      document.text = change.text;
      document.version++;
      return true;
    }
  }
};

function loadExtension() {
  // Supply the editor API while exercising the actual packaged extension and model.
  const Module = require("node:module");
  const load = Module._load;
  Module._load = function (name, ...args) { return name === "vscode" ? vscode : load.call(this, name, ...args); };
  try { return require(path.join(extensionPath, "extension.cjs")); }
  finally { Module._load = load; }
}

let assistant;
try {
  await fs.writeFile(file.fsPath, before);
  const { Assistant } = loadExtension();
  assistant = new Assistant({
    extensionPath,
    globalStorageUri: { fsPath: workspace },
    globalState: { get: (key, fallback) => state.get(key) ?? fallback, async update(key, value) { state.set(key, value); } }
  });
  assistant.services.hw = { tier: 1, gb: 8, files: 1 };
  assistant.post = message => messages.push(message);

  if (exerciseHandoff) {
    const { LocalEngine } = await import(pathToFileURL(path.join(extensionPath, "engine.mjs")).href);
    assistant.engine = new LocalEngine();
    const generate = assistant.engine.run.bind(assistant.engine);
    assistant.engine.run = options => {
      attempts.push(options.model.id);
      if (attempts.length === 1) return Promise.resolve({ text: '{"summary":"Draft","edits":[]}' });
      return generate(options);
    };
  }
  await assistant.dispatch({ type: "send", mode: "agent", text: "In hello.ts, change the greeting from Hello to Hi." });
  assert.ok(assistant.pending, messages.filter(message => message.type === "end").at(-1)?.text ?? "No final response");
  assert.equal(document.text, before);
  assert.equal(await fs.readFile(file.fsPath, "utf8"), before);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].name, "vscode.diff");
  assert.equal(assistant.previews.get(previews[0].preview.toString()), before.replace("Hello", "Hi"));

  await assistant.dispatch({ type: "apply" });
  assert.equal(document.text, before.replace("Hello", "Hi"));
  assert.equal(await fs.readFile(file.fsPath, "utf8"), document.text);
  assert.equal(assistant.pending, null);
  assert.ok(state.get("audit").some(entry => entry.event === "agent.apply"));
  if (exerciseHandoff) {
    assert.deepEqual(attempts, ["qwen2.5-coder-0.5b-q4", "qwen2.5-coder-1.5b-q4"]);
    console.log("Workbench handed a rejected nano proposal to the starter coder for one validated retry.");
  }
  const backend = messages.some(message => message.type === "phase" && message.text.startsWith("Running on CPU")) ? "CPU" : "native";
  console.log(`Packaged Workbench Agent generated, reviewed and applied an edit with the ${backend} backend.`);
} finally {
  await assistant?.engine?.dispose();
  await fs.rm(workspace, { recursive: true, force: true });
}
