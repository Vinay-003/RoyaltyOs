import React, { useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, showToast } from "../lib/api.ts";
import { Bot, Send, Terminal, Sparkles, CheckCircle2 } from "lucide-react";

interface AgentMeta {
  model?: string;
  invoiceCount?: number;
}

export function PayPalAIPage() {
  const { workspaceId, projectId } = useApp();
  const [prompt, setPrompt] = useState("Explain the current reserve holdback and remaining unrecouped advances for this project.");
  const [answer, setAnswer] = useState<string | null>(null);
  const [meta, setMeta] = useState<AgentMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || (!workspaceId && !projectId)) return;
    setLoading(true);
    setAnswer(null);
    setMeta(null);
    try {
      const res = await api<{ answer?: string; text?: string; model?: string; invoiceCount?: number }>("/api/v1/assistant/paypal", {
        method: "POST",
        json: {
          workspaceId,
          projectId,
          question: prompt.trim(),
        },
      });
      setAnswer(res.text || res.answer || "No response received.");
      const nextMeta: AgentMeta = {};
      if (res.model) nextMeta.model = res.model;
      if (typeof res.invoiceCount === "number") nextMeta.invoiceCount = res.invoiceCount;
      setMeta(nextMeta);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>INTELLIGENT FINANCIAL AUDIT</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>PayPal Autonomous AI Agent</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Read-only PayPal intelligence. Answered directly from live verified workspace records and PayPal remote tools.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ padding: 6, background: "rgba(37,99,235,0.15)", borderRadius: 6, color: "var(--accent)" }}>
              <Bot size={18} />
            </div>
            <div>
              <h2 className="card-title">Financial Intelligence Copilot</h2>
              <p className="card-sub">Bounded read-only query agent</p>
            </div>
          </div>
          <span className="badge badge-neutral">Read-Only Sandbox</span>
        </div>

        <form onSubmit={handleAsk} style={{ marginBottom: 16 }}>
          <div className="field">
            <label>Ask a financial question about this contract, invoices, or settlements</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask about recoupment, splits, settlements, or reserve status..."
                style={{ flex: 1 }}
              />
              <button type="submit" disabled={loading} className="btn btn-primary">
                <Sparkles size={14} />
                {loading ? "Thinking..." : "Query Agent"}
              </button>
            </div>
          </div>
        </form>

        {answer && (
          <div style={{ background: "var(--bg-input)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                <Terminal size={14} /> Agent Verified Response
              </div>
              {meta && (
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Model: {meta.model || "Groq/OpenAI"} · Answered from {meta.invoiceCount ?? 0} live invoice(s)
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
              {answer}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
