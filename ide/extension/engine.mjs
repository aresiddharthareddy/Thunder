import { getLlama, LlamaChatSession } from "node-llama-cpp";
import { verifyFile } from "./models.mjs";

export const editSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    edits: { type: "array", items: { type: "object", properties: {
      file: { type: "string" }, search: { type: "string" }, replace: { type: "string" }
    }}}
  }
};

export class LocalEngine {
  async run({ mode, input, context, history = "", file, model, signal, onText = () => {}, maxTokens = 768 }) {
    if (this.busy) throw new Error("Another local response is running.");
    this.busy = true;
    let ctx;
    let session;
    try {
      if (file !== this.file) {
        await this.loaded?.dispose();
        this.file = undefined;
        this.loaded = undefined;
        await verifyFile(file, model, signal);
        this.runtime ??= await getLlama({ gpu: "auto", build: "never", skipDownload: true, progressLogs: false });
        this.loaded = await this.runtime.loadModel({ modelPath: file, loadSignal: signal });
        this.file = file;
      }
      signal.throwIfAborted();
      ctx = await this.loaded.createContext({ contextSize: 4096, sequences: 1 });
      const sequence = ctx.getSequence();
      const system = ({
        ask: "You are Thunder, a local coding assistant. Answer the question directly. Cite the file and line for claims about the supplied project. Say when information is missing.",
        plan: "You are Thunder. Write a concise numbered implementation plan naming the affected files and checks. Answer using the supplied project context.",
        agent: "Propose edits as JSON. Use only the provided files. Each search string must occur exactly once in the original file. Preserve indentation. Do not include line number prefixes in search strings. Return an empty edits array if uncertain."
      })[mode];
      const tokenize = t => this.loaded.tokenize(t);
      const fixed = tokenize(system + input + history).length + maxTokens + 256;
      if (fixed >= ctx.contextSize) throw new Error("Shorten the request to fit the local model context.");
      const excerpt = this.loaded.detokenize(tokenize(context).slice(0, ctx.contextSize - fixed));
      session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
      signal.throwIfAborted();
      const started = Date.now();
      const text = await session.prompt([history, excerpt, input].filter(Boolean).join("\n\n"), {
        signal, maxTokens, temperature: mode === "agent" ? 0 : 0.15,
        grammar: mode === "agent" ? await this.runtime.createGrammarForJsonSchema(editSchema) : undefined,
        onTextChunk(chunk) { if (!signal.aborted) onText(chunk); }
      });
      return { text, elapsedMs: Date.now() - started, ...sequence.tokenMeter.getState() };
    } finally {
      try { session?.dispose(); await ctx?.dispose(); }
      finally { this.busy = false; }
    }
  }
  async dispose() { await this.loaded?.dispose(); await this.runtime?.dispose(); }
}
