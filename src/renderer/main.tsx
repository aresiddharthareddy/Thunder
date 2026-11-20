import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import type { DiagnosticReport } from "../shared/diagnostics";
import type { CatalogModel, DownloadProgress, Entitlement, HardwareProfile } from "../shared/types";
import { Workspace } from "./workspace/Workspace";

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function HardwareCard({ hardware }: { hardware: HardwareProfile }): JSX.Element {
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">ONBOARDING · STEP 2</p>
          <h2>Your hardware</h2>
        </div>
        <span className="tier-badge">Tier {hardware.tier}</span>
      </div>
      <p className="reason">{hardware.tierReason}</p>
      <div className="stats">
        <div><span>Memory</span><strong>{formatBytes(hardware.totalRamBytes)}</strong></div>
        <div><span>Free memory</span><strong>{formatBytes(hardware.freeRamBytes)}</strong></div>
        <div><span>GPU</span><strong>{hardware.gpu?.name ?? "None detected"}</strong></div>
        <div><span>VRAM</span><strong>{hardware.gpu?.vramBytes ? formatBytes(hardware.gpu.vramBytes) : "Not available"}</strong></div>
        <div><span>Platform</span><strong>{hardware.os} · {hardware.arch}</strong></div>
        <div><span>Free disk</span><strong>{formatBytes(hardware.freeDiskBytes)}</strong></div>
      </div>
    </section>
  );
}

function ProPreview({ entitlement }: { entitlement: Entitlement | null }): JSX.Element {
  const [email, setEmail] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [plan, setPlan] = useState<"annual" | "monthly" | "team">("annual");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  if (entitlement?.tier === "pro") return <section className="card pro-card"><p className="eyebrow">THUNDER PRO</p><h2>Pro features unlocked</h2><p className="reason">Your local license is active until {new Date(entitlement.expiresAt ?? 0).toLocaleDateString()}.</p></section>;
  async function activate(): Promise<void> { if (!licenseKey.trim() || activating) return; setActivating(true); setActivationError(null); try { await window.thunder.entitlement.activate(licenseKey.trim()); window.location.reload(); } catch (reason) { setActivationError(reason instanceof Error ? reason.message : String(reason)); } finally { setActivating(false); } }
  async function submit(): Promise<void> {
    setError(null);
    try { await window.thunder.waitlist.submit({ email, planInterest: plan }); setSubmitted(true); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <section className="card pro-card"><p className="eyebrow">PRO PREVIEW</p><h2>Unlock more local intelligence</h2><p className="reason">Manual model pinning, performance tuning, team policy, and diagnostic bundles are planned for Thunder Pro. Join the waitlist; no payment is taken.</p><div className="license-form"><input aria-label="License key" value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} placeholder="Paste an Ed25519 license key" /><button type="button" onClick={() => void activate()} disabled={activating || !licenseKey.trim()}>{activating ? "Activating…" : "Activate license"}</button>{activationError && <small className="error">{activationError}</small>}</div>{submitted ? <p className="saved">You’re on the waitlist. We’ll keep your request local until you choose to share it.</p> : <div className="waitlist-form"><input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" /><select aria-label="Plan" value={plan} onChange={(event) => setPlan(event.target.value as typeof plan)}><option value="annual">$49 / year</option><option value="monthly">$6 / month</option><option value="team">Team</option></select><button type="button" onClick={() => void submit()}>Join waitlist</button>{error && <small className="error">{error}</small>}</div>}</section>;
}

function App(): JSX.Element {
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<Array<CatalogModel & { downloaded: boolean }>>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [workspace, setWorkspace] = useState(false);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [zeroOutbound, setZeroOutbound] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);

  async function refreshCatalog(): Promise<void> {
    setCatalogLoading(true);
    try { setModels(await window.thunder.catalog.list()); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Model catalog could not be loaded"); }
    finally { setCatalogLoading(false); }
  }

  useEffect(() => {
    if (!window.thunder) {
      setError("Thunder bridge is unavailable. Run this page from the Electron app.");
      return;
    }
    window.thunder.hardware.detect().then(setHardware).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Hardware scan failed");
    });
    void refreshCatalog();
    void window.thunder.entitlement.get().then(setEntitlement).catch(() => setEntitlement(null));
    void window.thunder.security.zeroOutbound.get().then(setZeroOutbound).catch(() => undefined);
    return window.thunder.catalog.onProgress((update) => setProgress((current) => ({ ...current, [update.modelId]: update })));
  }, []);

  async function download(modelId: string): Promise<void> {
    try { await window.thunder.catalog.downloadStart(modelId); await refreshCatalog(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Model download failed"); }
  }
  async function toggleDownload(modelId: string, downloading: boolean): Promise<void> { if (!downloading) { await download(modelId); return; } await window.thunder.catalog.downloadCancel(modelId); setProgress((current) => ({ ...current, [modelId]: { ...(current[modelId] ?? { modelId, downloadedBytes: 0, totalBytes: 0 }), phase: "error", error: "Paused" } })); }

  async function saveDiagnostics(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const result = await window.thunder.doctor.save();
      if (result.saved) setReport(await window.thunder.doctor.collect());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save diagnostics");
    } finally {
      setSaving(false);
    }
  }

  const compatibleDownloaded = hardware ? models.find((model) => model.downloaded && (model.tier <= hardware.tier || (hardware.tier === 2.5 && model.tier <= 2))) : undefined;
  return (
    workspace && hardware && compatibleDownloaded ? <><header className="topbar"><div className="brand-mark">T</div><div><div className="brand">THUNDER</div><div className="subtitle">Local-first coding intelligence</div></div><button className="workspace-back" type="button" onClick={() => setWorkspace(false)}>Back to setup</button></header><Workspace modelId={compatibleDownloaded.id} tier={hardware.tier} /></> :
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">T</div>
        <div><div className="brand">THUNDER</div><div className="subtitle">Local-first coding intelligence</div></div>
        <div className="status"><span className="status-dot" /> Local beta</div>
      </header>
      <div className="content">
        <div className="intro">
          <p className="eyebrow">WELCOME TO THUNDER</p>
          <h1>Let’s understand your machine.</h1>
          <p>Thunder uses your local hardware profile to select safe, capable defaults for development.</p>
        </div>
        {error && <div className="error">{error}</div>}
        {!hardware && !error && <section className="card scanning">Scanning hardware<span className="pulse">…</span></section>}
        {hardware && <HardwareCard hardware={hardware} />}
        <section className="card privacy-card"><div><p className="eyebrow">PRIVACY</p><h2>Zero Outbound Mode</h2><p className="reason">Block catalog refreshes and all model downloads. Inference and project data remain local.</p></div><label className="toggle"><input type="checkbox" checked={zeroOutbound} onChange={(event) => { setZeroOutbound(event.target.checked); void window.thunder.security.zeroOutbound.set(event.target.checked); }} /><span>{zeroOutbound ? "Enabled" : "Disabled"}</span></label></section>
        <ProPreview entitlement={entitlement} />
        <section className="card model-card">
          <div className="card-heading"><div><p className="eyebrow">M2 · LOCAL MODELS</p><h2>Model catalog</h2></div><span className="model-count">{models.length} available</span></div>
          <p className="reason">Download a model locally when you are ready. Downloads are verified with SHA-256 before activation.</p>
          <div className="model-list">{catalogLoading && <p className="reason">Loading verified catalog…</p>}{!catalogLoading && models.length === 0 && <button type="button" onClick={() => void refreshCatalog()}>Retry catalog</button>}{models.filter((model) => !hardware || model.tier <= hardware.tier || (hardware.tier === 2.5 && model.tier <= 2)).map((model) => { const update = progress[model.id]; const percent = update?.totalBytes ? Math.floor(update.downloadedBytes / update.totalBytes * 100) : 0; const restricted = !["Apache-2.0", "MIT"].includes(model.license) && entitlement?.tier !== "pro"; const downloading = update?.phase === "downloading"; return <div className="model-row" key={model.id}><div><strong>{model.displayName}</strong><span>{(model.sizeBytes / 1024 ** 3).toFixed(1)} GB · {model.license}</span>{update && <div className="progress"><i style={{ width: `${percent}%` }} /></div>}</div><button type="button" disabled={restricted || model.downloaded || update?.phase === "verifying"} onClick={() => void toggleDownload(model.id, downloading)}>{restricted ? "Pro only" : model.downloaded ? "Downloaded" : downloading ? "Pause" : update?.phase === "error" ? "Resume" : update ? `${update.phase} ${percent}%` : "Download"}</button></div>; })}</div>
        </section>
        <section className="doctor-row">
          <div><p className="eyebrow">DEVELOPER TOOLS</p><h3>Thunder Doctor</h3><p>Collect a local diagnostic report for troubleshooting. Nothing is uploaded.</p></div>
          <button type="button" onClick={() => void saveDiagnostics()} disabled={saving}>{saving ? "Saving…" : "Export diagnostics"}</button>
        </section>
        {report && <p className="saved">Diagnostic report collected successfully.</p>}
        {compatibleDownloaded && <button className="open-workspace" type="button" onClick={() => setWorkspace(true)}>Open coding workspace</button>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
