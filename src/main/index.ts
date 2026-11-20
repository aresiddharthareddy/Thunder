import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHardwareIpc } from "./ipc/hardware.ipc.js";
import { registerDoctorIpc } from "./ipc/doctor.ipc.js";
import { registerCatalogIpc } from "./ipc/catalog.ipc.js";
import { setZeroOutbound } from "../core/security.js";
import { db } from "./db/index.js";
import { registerInferenceIpc } from "./ipc/inference.ipc.js";
import { registerSecurityIpc } from "./ipc/security.ipc.js";
import { registerFilesIpc } from "./ipc/files.ipc.js";
import { registerChatIpc } from "./ipc/chat.ipc.js";
import { registerTerminalIpc } from "./ipc/terminal.ipc.js";
import { registerEntitlementIpc } from "./ipc/entitlement.ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Thunder",
    backgroundColor: "#0c0f14",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerHardwareIpc();
  registerDoctorIpc();
  registerCatalogIpc();
  registerInferenceIpc();
  registerSecurityIpc();
  registerFilesIpc();
  registerChatIpc();
  registerTerminalIpc();
  registerEntitlementIpc();
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get("zero_outbound") as { value: string } | undefined;
  setZeroOutbound(row?.value === "true");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
