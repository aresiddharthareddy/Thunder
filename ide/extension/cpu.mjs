import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const bundledBinary = fileURLToPath(new URL("./runtime/llama-completion", import.meta.url));

function chatText(text) {
  // Keep model control tokens in workspace files and user messages inert.
  return text.replace(/<\|/g, "< |");
}

function utf8Prefix(text, bytes) {
  const buffer = Buffer.from(text);
  if (buffer.length <= bytes) return text;
  let end = bytes;
  while ((buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

export function runCpu({ binary = bundledBinary, file, system, input, context, history, signal, maxTokens, contextSize, schema, onText }) {
  const fixed = Buffer.byteLength(chatText(system + input)) + maxTokens + 96;
  const remaining = contextSize - fixed;
  if (remaining < 0) throw new Error("Shorten the request to fit the local model context.");
  const notes = utf8Prefix(chatText(history), Math.floor(remaining / 6));
  const excerpt = utf8Prefix(chatText(context), remaining - Buffer.byteLength(notes));
  const message = [notes, excerpt, chatText(input)].filter(Boolean).join("\n\n");
  const prompt = `<|im_start|>system\n${chatText(system)}<|im_end|>\n<|im_start|>user\n${message}<|im_end|>\n<|im_start|>assistant\n`;
  const args = [
    "--model", file, "--device", "none", "--gpu-layers", "0", "--no-op-offload",
    "--ctx-size", String(contextSize), "--n-predict", String(maxTokens),
    "--no-conversation", "--no-display-prompt", "--temp", schema ? "0" : "0.15",
    "--file", "/dev/stdin",
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  runSignal.throwIfAborted();
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
      signal: runSignal,
      killSignal: "SIGKILL",
    });
    let output = "";
    let emitted = 0;
    let diagnostics = "";
    let failure;
    child.stdout.setEncoding("utf8").on("data", chunk => {
      if (runSignal.aborted || failure) return;
      output += chunk;
      if (output.length > 64_000) {
        failure = new Error("The local CPU response exceeded its output limit.");
        child.kill("SIGKILL");
      } else {
        // The pinned completion CLI appends a short end-of-text notice on stdout.
        const end = output.length - 24;
        if (end > emitted) {
          onText(output.slice(emitted, end));
          emitted = end;
        }
      }
    });
    child.stderr.setEncoding("utf8").on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-8_000); });
    child.stdin.on("error", error => { if (error.code !== "EPIPE") failure ??= error; });
    child.on("error", error => { failure ??= error; });
    child.once("close", (code, killedBy) => {
      if (runSignal.aborted) return reject(runSignal.reason);
      if (failure?.code === "ENOENT") return reject(new Error("The bundled CPU runtime is missing. Reinstall Thunder Workbench."));
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`The local CPU runtime stopped (${killedBy ?? `exit ${code}`}). Run Thunder Doctor.`));
      const response = output.replace(/ \[end of text\]\s*$/, "");
      const text = response.trim();
      if (!text) return reject(new Error("The local model returned an empty response. Try a more specific request."));
      if (response.length > emitted) onText(response.slice(emitted));
      const usedOutputTokens = Number(diagnostics.match(/:\s+eval time\s*=.*?\/\s*(\d+) runs/)?.[1] ?? 0);
      resolve({ text, usedOutputTokens, elapsedMs: Date.now() - started, backend: "cpu" });
    });
    child.stdin.end(prompt);
  });
}
