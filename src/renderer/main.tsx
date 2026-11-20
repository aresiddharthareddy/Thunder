import { Component, StrictMode, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import type { DiagnosticReport } from "../shared/diagnostics";
import type { CatalogModel, DownloadProgress, Entitlement, HardwareProfile } from "../shared/types";
import { Workspace } from "./workspace/Workspace";

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

interface ErrorBoundaryState { error: Error | null; }
class RendererErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error("Thunder renderer crashed", error, info.componentStack); }
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <main className="app-shell crash-shell"><section className="card crash-card"><p className="eyebrow">THUNDER RECOVERY</p><h1>The workspace hit an unexpected error.</h1><p className="reason">{this.state.error.message || "The renderer stopped unexpectedly."}</p><div><button type="button" onClick={() => window.location.reload()}>Reload Thunder</button><button type="button" className="secondary-button" onClick={() => { this.setState({ error: null }); }}>Try again</button></div></section></main>;
  }
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
  const [autoPreparing, setAutoPreparing] = useState(false);

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
  async function prepareAutoPack(): Promise<void> {
    if (autoPreparing || !hardware || zeroOutbound) { if (zeroOutbound) setError("Turn off Zero Outbound to prepare the local Auto pack."); return; }
    const free = entitlement?.tier !== "pro";
    const candidates = models.filter((model) => !model.downloaded && (model.tier <= hardware.tier || (hardware.tier === 2.5 && model.tier <= 2)) && ["Apache-2.0", "MIT"].includes(model.license) && (!free || model.sizeBytes <= 2_000_000_000));
    if (!candidates.length) return;
    setAutoPreparing(true);
    try { for (const model of candidates) await download(model.id); }
    finally { setAutoPreparing(false); }
  }

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

  const free = entitlement?.tier !== "pro";
  const compatibleModels = hardware ? models.filter((model) => model.tier <= hardware.tier || (hardware.tier === 2.5 && model.tier <= 2)) : models;
  const autoPackModels = compatibleModels.filter((model) => ["Apache-2.0", "MIT"].includes(model.license) && model.sizeBytes <= 2_000_000_000);
  const autoPackDownloaded = autoPackModels.filter((model) => model.downloaded).length;
  const compatibleDownloaded = models.find((model) => model.downloaded && (model.tier <= (hardware?.tier ?? 1) || (hardware?.tier === 2.5 && model.tier <= 2)));
  return (
    workspace && hardware && compatibleDownloaded ? <><header className="topbar"><div className="brand-mark">T</div><div><div className="brand">THUNDER</div><div className="subtitle">Local-first coding intelligence</div></div><button className="workspace-back" type="button" onClick={() => setWorkspace(false)}>Back to setup</button></header><Workspace modelId={compatibleDownloaded.id} tier={hardware.tier} free={entitlement?.tier !== "pro"} /></> :
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
          <div className="card-heading"><div><p className="eyebrow">M2 · LOCAL MODELS</p><h2>{free ? "Hardware-matched Auto" : "Model Lab"}</h2></div><span className="model-count">{free ? `${autoPackDownloaded}/${autoPackModels.length} ready` : `${models.length} available`}</span></div>
          <p className="reason">{free ? "Thunder selects and switches between a verified nano and coder pack automatically. Model names and manual pinning stay hidden in Free." : "Browse compatible models, download them, and choose the default for Ask, Plan, or Agent."}</p>
          {free ? <>
            <button type="button" onClick={() => void prepareAutoPack()} disabled={autoPreparing || zeroOutbound || catalogLoading}>{autoPreparing ? "Preparing Auto pack…" : zeroOutbound ? "Turn off Zero Outbound to prepare" : autoPackDownloaded === autoPackModels.length && autoPackModels.length > 0 ? "Auto pack ready" : "Prepare Free Auto pack"}</button>
            <div className="model-list auto-pack-list">{catalogLoading && <p className="reason">Loading verified catalog…</p>}{!catalogLoading && autoPackModels.length === 0 && <button type="button" onClick={() => void refreshCatalog()}>Retry catalog</button>}{autoPackModels.map((model) => { const update = progress[model.id]; const percent = update?.totalBytes ? Math.floor(update.downloadedBytes / update.totalBytes * 100) : model.downloaded ? 100 : 0; return <div className="model-row" key={model.id}><div><strong>Auto component · {(model.sizeBytes / 1024 ** 3).toFixed(1)} GB</strong><span>{model.downloaded ? "Verified and ready" : update?.phase === "error" ? "Paused — resume from Prepare Auto pack" : "Queued for the hardware-matched pack"}</span>{(update || model.downloaded) && <div className="progress"><i style={{ width: `${percent}%` }} /></div>}</div><span className="auto-status">{model.downloaded ? "Ready" : update?.phase === "downloading" ? `${percent}%` : "Pending"}</span></div>; })}</div>
          </> : <div className="model-list">{catalogLoading && <p className="reason">Loading verified catalog…</p>}{!catalogLoading && models.length === 0 && <button type="button" onClick={() => void refreshCatalog()}>Retry catalog</button>}{compatibleModels.map((model) => { const update = progress[model.id]; const percent = update?.totalBytes ? Math.floor(update.downloadedBytes / update.totalBytes * 100) : 0; const restricted = !["Apache-2.0", "MIT"].includes(model.license); const downloading = update?.phase === "downloading"; return <div className="model-row" key={model.id}><div><strong>{model.displayName}</strong><span>{(model.sizeBytes / 1024 ** 3).toFixed(1)} GB · {model.license}</span>{update && <div className="progress"><i style={{ width: `${percent}%` }} /></div>}</div><button type="button" disabled={restricted || model.downloaded || update?.phase === "verifying"} onClick={() => void toggleDownload(model.id, downloading)}>{restricted ? "Pro only" : model.downloaded ? "Downloaded" : downloading ? "Pause" : update?.phase === "error" ? "Resume" : update ? `${update.phase} ${percent}%` : "Download"}</button></div>; })}</div>}
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

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><RendererErrorBoundary><App /></RendererErrorBoundary></StrictMode>);
