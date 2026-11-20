import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);

function waitForPort(port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

execSync("pnpm build:main", { stdio: "inherit" });

const vite = spawn("pnpm", ["exec", "vite", "--port", "5173", "--strictPort"], {
  stdio: "inherit",
  env: process.env,
});

const shutdown = (code) => {
  if (!vite.killed) vite.kill("SIGTERM");
  process.exit(code);
};

try {
  await waitForPort(5173, 30_000);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}

const electronBinary = require("electron");
const electron = spawn(electronBinary, ["."], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://localhost:5173",
  },
});

electron.on("exit", (code) => shutdown(code ?? 0));
vite.on("exit", (code) => {
  if (!electron.killed) electron.kill("SIGTERM");
  process.exit(code ?? 0);
});
