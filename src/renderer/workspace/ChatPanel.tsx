import { useEffect, useRef, useState } from "react";
import type { AgentPlanStep } from "../../../src/core/agent";

interface Message { role: "user" | "assistant"; content: string; streaming?: boolean; }
interface Session { id: string; title: string; mode: "ask" | "plan" | "agent"; updatedAt: number; }
interface Props { modelId: string; tier: 1 | 2 | 2.5 | 3; free: boolean; workspaceRoot: string; filePath: string; context: string; onRefresh: () => Promise<void>; }

const identityQuestion = /\b(who are you|what (?:ai |language )?model (?:are you|is this)|(?:your|underlying|actual|real) (?:model|identity)|what are you powered by)\b/i;

function parsePlan(text: string): AgentPlanStep[] {
  const source = text.match(/```json\s*([\s\S]*?)```/i)?.[1] ?? text;
  let parsed: unknown;
  try { parsed = JSON.parse(source.trim()); } catch { throw new Error("Agent returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { steps?: unknown }).steps)) throw new Error("Agent response did not contain a steps array");
  const steps = (parsed as { steps: unknown[] }).steps;
  if (!steps.length) throw new Error("Agent returned no actionable steps");
  return steps.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Invalid agent step ${index + 1}`);
    const step = item as { kind?: unknown; payload?: unknown };
    const payload = step.payload as { file?: unknown; search?: unknown; replace?: unknown } | undefined;
    if ((step.kind !== "read" && step.kind !== "search_replace") || !payload || typeof payload.file !== "string" || !payload.file || payload.file.startsWith("/") || payload.file.split("/").includes("..")) throw new Error(`Invalid or unsafe agent step ${index + 1}`);
    if (step.kind === "search_replace" && (typeof payload.search !== "string" || typeof payload.replace !== "string")) throw new Error(`Invalid replacement in agent step ${index + 1}`);
    return { kind: step.kind, payload } as AgentPlanStep;
  });
}

function stepPreview(step: AgentPlanStep): string {
  const payload = step.payload as { file?: string; search?: string; replace?: string };
  if (step.kind === "read") return `read ${payload.file}`;
  return `- ${(payload.search ?? "").slice(0, 240)}\n+ ${(payload.replace ?? "").slice(0, 240)}`;
}

export function ChatPanel({ modelId, tier, free, workspaceRoot, filePath, context, onRefresh }: Props): JSX.Element {
  const modes = ["ask", "plan", "agent"] as const;
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"ask" | "plan" | "agent">("ask");
  const [busy, setBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<AgentPlanStep[] | null>(null);
  const active = useRef<string | null>(null);
  const responseTimeout = useRef<number | null>(null);
  const session = useRef<string | null>(null);
  const lastRequest = useRef<string | null>(null);
  const agentRetries = useRef(0);
  const persistedUser = useRef(0);
  const persistedAssistant = useRef(0);

  function clearResponseTimeout(): void { if (responseTimeout.current !== null) { window.clearTimeout(responseTimeout.current); responseTimeout.current = null; } }
  function armResponseTimeout(): void { clearResponseTimeout(); responseTimeout.current = window.setTimeout(() => { void cancel("Local inference timed out. Run Thunder Doctor and retry with a smaller context."); }, mode === "agent" ? 90_000 : 120_000); }

  function restore(loaded: { id: string; messages: Array<{ role: string; content: string }> }): void {
    session.current = loaded.id;
    const restored = loaded.messages.filter((message): message is Message => message.role === "user" || message.role === "assistant");
    persistedUser.current = restored.filter((message) => message.role === "user").length;
    persistedAssistant.current = restored.filter((message) => message.role === "assistant").length;
    setMessages(restored); setPendingPlan(null);
  }

  useEffect(() => {
    void window.thunder.chat.list({ mode }).then(setSessions);
    void window.thunder.chat.latest({ mode }).then((latest) => {
      if (latest) restore(latest);
      else void window.thunder.chat.createSession({ mode }).then((created) => { session.current = created.id; });
    });
  }, [mode]);
  useEffect(() => {
    const finalized = messages.filter((message) => message.role === "assistant" && !message.streaming);
    if (session.current && finalized.length > persistedAssistant.current) { persistedAssistant.current = finalized.length; void window.thunder.chat.append({ sessionId: session.current, role: "assistant", content: finalized[finalized.length - 1].content }); }
  }, [messages]);
  useEffect(() => {
    const users = messages.filter((message) => message.role === "user");
    if (session.current && users.length > persistedUser.current) { persistedUser.current = users.length; void window.thunder.chat.append({ sessionId: session.current, role: "user", content: users[users.length - 1].content }); }
  }, [messages]);

  async function startInference(request: string, requestMode: "ask" | "plan" | "agent" = mode): Promise<void> {
    const decision = await window.thunder.inference.route({ input: request, mode: requestMode });
    if (!decision.modelId) throw new Error(`${decision.reason}. Download a compatible local model from setup, then try again.`);
    await window.thunder.inference.load(decision.modelId);
    const result = await window.thunder.inference.streamStart({ input: request, modelId: decision.modelId, mode: requestMode, context: `<file>${filePath}</file>\n<content>\n${context}\n</content>` });
    active.current = result.streamKey;
    armResponseTimeout();
  }

  async function retryAgent(reason: string): Promise<void> {
    const original = lastRequest.current;
    if (!original || agentRetries.current >= 1) return;
    agentRetries.current += 1;
    setMessages((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: "", streaming: true } : item));
    try {
      await startInference(`${original}\n\nThe previous proposal was rejected because: ${reason}. Return only the required JSON object with at least one safe read or search_replace step.`, "agent");
    } catch (error) {
      active.current = null; clearResponseTimeout(); setBusy(false); lastRequest.current = null;
      setMessages((items) => items.map((item, index) => index === items.length - 1 ? { role: "assistant", content: `[error] ${error instanceof Error ? error.message : String(error)}` } : item));
    }
  }

  useEffect(() => {
    const offToken = window.thunder.inference.onToken((event) => {
      if (event.streamKey !== active.current) return;
      clearResponseTimeout();
      setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + event.text }; return next; });
    });
    const offEnd = window.thunder.inference.onEnd((event) => {
      if (event.streamKey !== active.current) return;
      const output = event.error ? `[error] ${event.error}` : event.result.text;
      let plan: AgentPlanStep[] | null = null;
      let parseError: string | null = null;
      if (mode === "agent" && !event.error) { try { plan = parsePlan(output); } catch (error) { parseError = error instanceof Error ? error.message : String(error); } }
      if (mode === "agent" && (event.error || parseError) && agentRetries.current < 1) { void retryAgent(event.error ?? parseError ?? "invalid structured response"); return; }
      setBusy(false); active.current = null; lastRequest.current = null;
      setMessages((items) => { const next = [...items]; const last = next[next.length - 1]; if (last) next[next.length - 1] = { ...last, streaming: false, content: output || last.content || "No response returned." }; return next; });
      setPendingPlan(plan);
    });
    return () => { offToken(); offEnd(); clearResponseTimeout(); };
  }, [mode, filePath, context]);

  async function newChat(): Promise<void> { if (busy) return; const created = await window.thunder.chat.createSession({ mode }); session.current = created.id; persistedUser.current = 0; persistedAssistant.current = 0; setMessages([]); setPendingPlan(null); setSessions(await window.thunder.chat.list({ mode })); }
  async function selectSession(id: string): Promise<void> { if (busy || !id) return; const loaded = await window.thunder.chat.get(id); if (loaded) restore(loaded); }
  async function send(): Promise<void> {
    const text = input.trim(); if (!text || busy) return;
    setPendingPlan(null); setInput(""); setBusy(true); agentRetries.current = 0; lastRequest.current = text;
    setMessages((items) => [...items, { role: "user", content: text }, { role: "assistant", content: "", streaming: true }]);
    if (identityQuestion.test(text)) { setMessages((items) => [...items.slice(0, -1), { role: "assistant", content: "I'm Thunder Agent, your local coding assistant." }]); setBusy(false); lastRequest.current = null; return; }
    try { await startInference(text); }
    catch (error) { clearResponseTimeout(); setBusy(false); lastRequest.current = null; setMessages((items) => [...items.slice(0, -1), { role: "assistant", content: `[error] ${error instanceof Error ? error.message : String(error)}` }]); }
  }
  async function applyPlan(): Promise<void> {
    if (!pendingPlan || !workspaceRoot) return;
    setBusy(true);
    try { const result = await window.thunder.agent.run({ plan: pendingPlan, workspaceRoot, allowWrites: true }); if (result.status !== "completed") throw new Error(result.error ?? "Agent plan failed"); await onRefresh(); setPendingPlan(null); setMessages((items) => [...items, { role: "assistant", content: `Applied ${result.changedFiles.length} file(s) safely.` }]); }
    catch (error) { setMessages((items) => [...items, { role: "assistant", content: `[error] ${error instanceof Error ? error.message : String(error)}` }]); }
    finally { setBusy(false); }
  }
  async function cancel(message = "Cancelled."): Promise<void> {
    const streamKey = active.current;
    clearResponseTimeout();
    if (streamKey) await window.thunder.inference.streamCancel(streamKey);
    active.current = null; lastRequest.current = null; setBusy(false);
    setMessages((items) => items.map((item, index) => index === items.length - 1 && item.role === "assistant" ? { ...item, streaming: false, content: item.content || message } : item));
  }

  return <section className="chat-panel">
    <div className="chat-header"><span>Thunder Assistant</span><div><small>{free ? "Auto" : modelId} · Tier {tier}</small><button className="new-chat" type="button" onClick={() => void newChat()} disabled={busy}>New chat</button></div></div>
    <select className="session-picker" value={session.current ?? ""} onChange={(event) => void selectSession(event.target.value)} disabled={busy || sessions.length === 0}><option value="">Saved sessions</option>{sessions.map((item) => <option value={item.id} key={item.id}>{item.title} · {new Date(item.updatedAt).toLocaleDateString()}</option>)}</select>
    <div className="mode-picker">{modes.map((item) => <button className={mode === item ? "selected" : ""} type="button" key={item} onClick={() => setMode(item)} disabled={busy}>{item}</button>)}</div>
    <div className="messages">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><small>{message.role}</small><div>{message.content || (message.streaming ? "Thinking…" : "")}</div></div>)}</div>
    {pendingPlan && <div className="agent-review"><strong>Agent diff ready for review</strong><p className="review-note">No file is changed until you approve this bounded plan.</p><ul>{pendingPlan.map((step, index) => <li key={index}><code>{step.kind}</code><pre>{stepPreview(step)}</pre></li>)}</ul><div className="agent-actions"><button type="button" onClick={() => setPendingPlan(null)} disabled={busy}>Reject</button><button type="button" onClick={() => void applyPlan()} disabled={busy || !workspaceRoot}>Apply safely</button></div></div>}
    <div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={`${mode === "agent" ? "Describe the change…" : mode === "plan" ? "Describe the work to plan…" : "Ask about your code…"}`} rows={3} /><div><button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>Send</button>{busy && <button type="button" onClick={() => void cancel()}>Cancel</button>}</div></div>
  </section>;
}
