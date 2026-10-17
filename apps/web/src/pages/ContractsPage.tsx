import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { formatMoney, formatRate } from "../lib/format.ts";
import { evaluateFormula, validateFormulaSyntax } from "../../../../packages/core/formula.ts";
import {
  UploadCloud,
  FileCheck2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  Layers,
  Sparkles,
  BookOpen,
  Edit3,
  Bot,
  PlusCircle,
  Send,
  Calculator,
  HelpCircle,
  Check,
  X,
  Code2,
} from "lucide-react";

interface ContractItem {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

interface RuleEvidence {
  sourceDocument?: string;
  sourceVersion?: number;
  page?: number | null;
  clause?: string | null;
  sourceText?: string;
  model?: string;
}

interface CandidateRule {
  id: string;
  rule_type: string;
  beneficiary_key: string | null;
  base: string;
  rate_basis_points: number | null;
  fixed_minor: number | null;
  priority: number;
  confidence: number;
  status: string;
  evidence?: RuleEvidence;
  config?: Record<string, any>;
  conditions?: any[];
}

interface ContractAnalysisDetail {
  workspaceId: string;
  version: { id: string; version: number; title: string } | null;
  analysis: { id: string; status: string; warnings?: string[]; conflicts?: any[] } | null;
  rules: CandidateRule[];
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  patch?: Record<string, any>;
}

export function ContractsPage() {
  const { projectId } = useApp();
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractAnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [newTitle, setNewTitle] = useState("Creator Campaign Agreement");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Modal states
  const [editingRule, setEditingRule] = useState<CandidateRule | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [testRevenue, setTestRevenue] = useState(10000); // $100.00
  const [savingEdit, setSavingEdit] = useState(false);

  // AI Chat Co-Pilot modal
  const [chatRule, setChatRule] = useState<CandidateRule | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Add rule modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    ruleType: "FORMULA",
    beneficiaryKey: "creator",
    base: "REMAINDER",
    rateBasisPoints: 1500,
    fixedMinor: 0,
    priority: 10,
    formula: "net_revenue * 0.15",
    formulaExplanation: "15% royalty on residual net receipts",
    clause: "Special Addendum",
    sourceText: "Agreed terms for custom revenue share.",
  });

  const loadContracts = async () => {
    if (!projectId) return;
    try {
      const list = await api<ContractItem[]>(`/api/v1/contracts?projectId=${projectId}`);
      setContracts(list);
      if (!selectedId && list[0]) {
        setSelectedId(list[0].id);
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (contractId: string) => {
    try {
      const res = await api<ContractAnalysisDetail>(`/api/v1/contracts/${contractId}/analysis`);
      setDetail(res);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  useEffect(() => {
    loadContracts();
  }, [projectId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !newTitle.trim()) return;
    try {
      const res = await api<ContractItem>("/api/v1/contracts", {
        method: "POST",
        json: { projectId, title: newTitle.trim() },
      });
      showToast("Contract agreement created", "success");
      setContracts((prev) => [res, ...prev]);
      setSelectedId(res.id);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleUploadPdf = async () => {
    if (!selectedId || !selectedFile) {
      showToast("Select a PDF file first", "warn");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("title", selectedFile.name.replace(/\.pdf$/i, ""));

      const res = await api<{ contractVersionId: string; version: number }>(
        `/api/v1/contracts/${selectedId}/upload`,
        { method: "POST", body: form }
      );
      showToast(`Uploaded sealed version v${res.version}`, "success");
      setSelectedFile(null);
      await loadDetail(selectedId);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const handleRunAi = async () => {
    if (!selectedId) return;
    setAnalyzing(true);
    showToast("Extracting contract terms via Groq AI...", "info");
    try {
      const res = await api<{ candidatesCount: number }>(`/api/v1/contracts/${selectedId}/analyze`, {
        method: "POST",
        json: {},
      });
      showToast(`Extracted ${res.candidatesCount} candidate rules for review`, "success");
      await loadDetail(selectedId);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReviewRule = async (ruleId: string, action: "APPROVE" | "REJECT") => {
    try {
      await api(`/api/v1/rules/candidates/${ruleId}/review`, {
        method: "POST",
        json: { action },
      });
      setDetail((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          rules: prev.rules.map((r) =>
            r.id === ruleId ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r
          ),
        };
      });
      showToast(`Rule marked as ${action === "APPROVE" ? "Approved" : "Rejected"}`, "info");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleApproveAll = async () => {
    if (!detail) return;
    const pending = detail.rules.filter((r) => r.status === "PENDING" || r.status === "REVIEW_REQUIRED");
    for (const r of pending) {
      await handleReviewRule(r.id, "APPROVE");
    }
  };

  const handleActivateRuleSet = async () => {
    if (!selectedId) return;
    setActivating(true);
    try {
      const res = await withStepUp(() =>
        api<{ version: number }>(`/api/v1/contracts/${selectedId}/approve`, {
          method: "POST",
          json: {},
        })
      );
      showToast(`RuleSet v${res.version} activated and published to Rule Graph!`, "success");
      await loadDetail(selectedId);
      await loadContracts();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setActivating(false);
    }
  };

  // Open Edit Modal
  const openEditRule = (rule: CandidateRule) => {
    setEditingRule(rule);
    setEditForm({
      ruleType: rule.rule_type,
      beneficiaryKey: rule.beneficiary_key || "",
      base: rule.base || "REMAINDER",
      rateBasisPoints: rule.rate_basis_points ?? 0,
      fixedMinor: rule.fixed_minor ?? 0,
      priority: rule.priority ?? 10,
      formula: rule.config?.formula || "",
      formulaExplanation: rule.config?.formulaExplanation || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingRule) return;
    setSavingEdit(true);
    try {
      const patchConfig = {
        ...(editingRule.config || {}),
        formula: editForm.formula ? editForm.formula.trim() : null,
        formulaExplanation: editForm.formulaExplanation ? editForm.formulaExplanation.trim() : null,
      };

      const updated = await api(`/api/v1/rules/candidates/${editingRule.id}/review`, {
        method: "POST",
        json: {
          action: "UPDATE",
          ruleType: editForm.ruleType,
          beneficiaryKey: editForm.beneficiaryKey ? editForm.beneficiaryKey.trim() : null,
          base: editForm.base,
          rateBasisPoints: Number(editForm.rateBasisPoints),
          fixedMinor: Number(editForm.fixedMinor),
          priority: Number(editForm.priority),
          config: patchConfig,
        },
      });

      showToast("Rule updated successfully", "success");
      setEditingRule(null);
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // Open AI Chat Modal
  const openChatWithAi = (rule: CandidateRule) => {
    setChatRule(rule);
    setChatMessages([
      {
        role: "assistant",
        text: `Hello! I'm your Contract AI Co-Pilot. I can help refine this rule (${rule.rule_type} for ${rule.beneficiary_key || "unassigned"}), rewrite formulas, adjust percentages, or verify clause grounding. What would you like to change?`,
      },
    ]);
    setChatInput("");
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !chatRule || chatLoading) return;
    const userPrompt = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: userPrompt }]);
    setChatLoading(true);

    try {
      const res = await api<{ explanation: string; suggestedPatch: Record<string, any> }>(
        `/api/v1/rules/candidates/${chatRule.id}/assist`,
        {
          method: "POST",
          json: { prompt: userPrompt, contractId: selectedId },
        }
      );

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.explanation,
          patch: res.suggestedPatch,
        },
      ]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error consulting AI: ${err.message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleApplyAiPatch = async (patch: Record<string, any>) => {
    if (!chatRule) return;
    try {
      const updatePayload: any = { action: "UPDATE" };
      if (patch.ruleType) updatePayload.ruleType = patch.ruleType;
      if (patch.base) updatePayload.base = patch.base;
      if (patch.rateBasisPoints !== undefined) updatePayload.rateBasisPoints = patch.rateBasisPoints;
      if (patch.fixedMinor !== undefined) updatePayload.fixedMinor = patch.fixedMinor;
      if (patch.priority !== undefined) updatePayload.priority = patch.priority;
      if (patch.config) updatePayload.config = { ...(chatRule.config || {}), ...patch.config };

      await api(`/api/v1/rules/candidates/${chatRule.id}/review`, {
        method: "POST",
        json: updatePayload,
      });

      showToast("AI adjustments applied to rule!", "success");
      setChatRule(null);
      if (selectedId) await loadDetail(selectedId);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  // Add Manual Rule
  const handleCreateManualRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await api("/api/v1/rules/candidates", {
        method: "POST",
        json: {
          contractId: selectedId,
          ruleType: addForm.ruleType,
          beneficiaryKey: addForm.beneficiaryKey,
          base: addForm.base,
          rateBasisPoints: Number(addForm.rateBasisPoints),
          fixedMinor: Number(addForm.fixedMinor),
          priority: Number(addForm.priority),
          clause: addForm.clause,
          sourceText: addForm.sourceText,
          config: {
            formula: addForm.formula,
            formulaExplanation: addForm.formulaExplanation,
          },
        },
      });

      showToast("Custom rule created successfully!", "success");
      setShowAddModal(false);
      await loadDetail(selectedId);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div className="kicker" style={{ marginBottom: 4 }}>CONTRACT INTELLIGENCE & RULE COMPOSER</div>
        <h1 style={{ fontSize: 26, margin: "0 0 6px" }}>Commercial Agreements</h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Ground contractual clauses in source documents, compose dynamic formulas, and verify rule allocations.
        </p>
      </div>

      <div className="grid-2">
        {/* Left Column: Agreements List & Upload */}
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Agreement Instruments</h2>
              <p className="card-sub">Manage contracts in this workspace</p>
            </div>
          </div>

          <form onSubmit={handleCreateContract} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              type="text"
              className="input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Master Distribution Agreement 2026"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-secondary">
              + New Contract
            </button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {contracts.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${selectedId === c.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  background: selectedId === c.id ? "var(--bg-card-hover)" : "var(--bg-card)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  boxShadow: selectedId === c.id ? "0 2px 10px var(--accent-glow)" : "none",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{c.title}</strong>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    ID: {c.id.slice(0, 16)}...
                  </div>
                </div>
                <span className={`badge ${c.status === "ACTIVE" ? "badge-green" : "badge-neutral"}`}>
                  {c.status}
                </span>
              </div>
            ))}
            {contracts.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                No contract agreements registered yet.
              </div>
            )}
          </div>

          {selectedId && (
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>
                Upload Contract PDF
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  style={{ fontSize: 12, color: "var(--text-secondary)" }}
                />
                <button
                  onClick={handleUploadPdf}
                  disabled={uploading || !selectedFile}
                  className="btn btn-primary"
                  style={{ whiteSpace: "nowrap" }}
                >
                  <UploadCloud size={14} />
                  {uploading ? "Sealing..." : "Upload & Seal"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: AI Extraction & Active Version Details */}
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Contract Version & Extraction</h2>
              <p className="card-sub">Extract and ground rules with source quotes</p>
            </div>
            {detail?.version && (
              <button
                onClick={handleRunAi}
                disabled={analyzing}
                className="btn btn-primary"
                style={{ background: "linear-gradient(135deg, #1e56c7, #2563eb)" }}
              >
                <Sparkles size={14} />
                {analyzing ? "Extracting..." : "Run AI Extraction"}
              </button>
            )}
          </div>

          {detail?.version ? (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: 12, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <div className="kicker">DOCUMENT VERSION</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
                    v{detail.version.version} · {detail.version.title}
                  </div>
                </div>
                <div style={{ flex: 1, padding: 12, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <div className="kicker">STATUS</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
                    {detail.rules.length} Rules Extracted
                  </div>
                </div>
              </div>

              {detail.analysis?.warnings && detail.analysis.warnings.length > 0 && (
                <div style={{ background: "var(--badge-amber-bg)", border: "1px solid var(--badge-amber-border)", borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--badge-amber-text)", display: "flex", alignItems: "center", gap: 6 }}>
                    <AlertTriangle size={14} /> Warnings Detected:
                  </div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 11, color: "var(--text-secondary)" }}>
                    {detail.analysis.warnings.map((w, idx) => (
                      <li key={idx}>{typeof w === "string" ? w : JSON.stringify(w)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: 36, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Select a contract and upload a PDF agreement to view extraction details.
            </div>
          )}
        </section>
      </div>

      {/* Candidate Rules Section */}
      {detail && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div>
              <h2 className="card-title">Candidate Financial Rules</h2>
              <p className="card-sub">
                Review, edit formulas, chat with AI, or manually author rules before activating the immutable RuleSet.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setShowAddModal(true)}
                className="btn btn-secondary"
                style={{ borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
              >
                <PlusCircle size={14} />
                + Add Custom Rule
              </button>

              <button
                onClick={handleApproveAll}
                disabled={!detail.rules.some((r) => r.status === "PENDING" || r.status === "REVIEW_REQUIRED")}
                className="btn btn-secondary"
              >
                <CheckCircle size={14} />
                Approve All Pending
              </button>

              <button
                onClick={handleActivateRuleSet}
                disabled={activating || detail.rules.some((r) => r.status === "PENDING" || r.status === "REVIEW_REQUIRED")}
                className="btn btn-primary"
              >
                <FileCheck2 size={14} />
                {activating ? "Activating..." : "Activate Approved RuleSet"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {detail.rules.map((rule) => {
              const statusBadge =
                rule.status === "APPROVED"
                  ? "badge-green"
                  : rule.status === "REJECTED"
                  ? "badge-red"
                  : "badge-amber";

              const pageDisplay = rule.evidence?.page ? `Page ${rule.evidence.page}` : "Page (inferred)";
              const clauseDisplay = rule.evidence?.clause ? `Clause: ${rule.evidence.clause}` : "Clause: General Terms";

              return (
                <div key={rule.id} className="rule-card">
                  <div className="rule-card-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="badge badge-neutral" style={{ textTransform: "uppercase" }}>
                        {rule.rule_type}
                      </span>
                      <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>
                        {rule.beneficiary_key ? rule.beneficiary_key.replace(/_/g, " ").toUpperCase() : "Waterfall Obligation"}
                      </strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`badge ${statusBadge}`}>{rule.status}</span>
                      <button
                        onClick={() => openChatWithAi(rule)}
                        className="btn btn-secondary"
                        style={{ padding: "4px 8px", fontSize: 11, display: "inline-flex", gap: 4 }}
                        title="Chat with AI about this rule"
                      >
                        <Bot size={13} color="var(--accent-primary)" />
                        Ask AI
                      </button>
                      <button
                        onClick={() => openEditRule(rule)}
                        className="btn btn-secondary"
                        style={{ padding: "4px 8px", fontSize: 11, display: "inline-flex", gap: 4 }}
                        title="Edit rule parameters & formula"
                      >
                        <Edit3 size={13} />
                        Edit
                      </button>
                    </div>
                  </div>

                  <div className="rule-meta">
                    <span>Rate: <strong style={{ color: "var(--text-primary)" }}>{formatRate(rule.rate_basis_points)}</strong></span>
                    <span>Fixed: <strong style={{ color: "var(--text-primary)" }}>{formatMoney(rule.fixed_minor)}</strong></span>
                    <span>Priority: <strong style={{ color: "var(--text-primary)" }}>{rule.priority}</strong></span>
                    <span>Base: <strong style={{ color: "var(--accent-primary)" }}>{rule.base}</strong></span>
                    {rule.config?.advanceMinor && (
                      <span>Advance: <strong style={{ color: "var(--text-primary)" }}>{formatMoney(rule.config.advanceMinor)}</strong></span>
                    )}
                    {rule.config?.preRecoupmentBasisPoints && (
                      <span>Pre-Recoupment: <strong style={{ color: "var(--text-primary)" }}>{formatRate(rule.config.preRecoupmentBasisPoints)}</strong></span>
                    )}
                  </div>

                  {/* Mathematical Formula Preview for FORMULA rules */}
                  {rule.config?.formula && (
                    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
                        <Calculator size={13} color="var(--accent-primary)" />
                        <strong>Evaluated Mathematical Formula:</strong>
                      </div>
                      <code style={{ fontSize: 12, color: "var(--accent-primary)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                        {rule.config.formula}
                      </code>
                      {rule.config.formulaExplanation && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                          {rule.config.formulaExplanation}
                        </div>
                      )}
                    </div>
                  )}

                  {rule.config?.tiers && Array.isArray(rule.config.tiers) && (
                    <div style={{ background: "var(--bg-elevated)", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 11 }}>
                      <strong>Cumulative Tiers:</strong>
                      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                        {rule.config.tiers.map((t: any, i: number) => (
                          <span key={i} className="num">
                            {t.label || `Tier ${i + 1}`}: {formatRate(t.rateBasisPoints)} (Threshold: {formatMoney(t.thresholdMinor)})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {rule.evidence?.sourceText && (
                    <div className="rule-quote">
                      "{rule.evidence.sourceText}"
                    </div>
                  )}

                  <div className="rule-evidence-footer">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="evidence-badge">
                        <BookOpen size={12} color="var(--accent-primary)" />
                        {pageDisplay} · {clauseDisplay}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        {rule.evidence?.model || "openai/gpt-oss-120b"}
                      </span>
                    </div>

                    {rule.status !== "APPROVED" && rule.status !== "REJECTED" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleReviewRule(rule.id, "APPROVE")}
                          className="btn btn-secondary"
                          style={{ padding: "4px 10px", fontSize: 11, borderColor: "var(--badge-green-border)", color: "var(--badge-green-text)" }}
                        >
                          <CheckCircle size={13} /> Approve
                        </button>
                        <button
                          onClick={() => handleReviewRule(rule.id, "REJECT")}
                          className="btn btn-secondary"
                          style={{ padding: "4px 10px", fontSize: 11, borderColor: "var(--badge-red-border)", color: "var(--badge-red-text)" }}
                        >
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {detail.rules.length === 0 && (
              <div style={{ padding: 36, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No candidate rules extracted yet. Run extraction or click "+ Add Custom Rule" to define one.
              </div>
            )}
          </div>
        </section>
      )}

      {/* MODAL 1: HUMAN EDIT RULE & LIVE FORMULA TESTER */}
      {editingRule && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Edit Financial Rule</h3>
              <button onClick={() => setEditingRule(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Rule Type</label>
                <select
                  className="input"
                  value={editForm.ruleType}
                  onChange={(e) => setEditForm({ ...editForm, ruleType: e.target.value })}
                >
                  <option value="PERCENTAGE">PERCENTAGE</option>
                  <option value="FORMULA">FORMULA (Custom Math)</option>
                  <option value="FIXED_AMOUNT">FIXED_AMOUNT</option>
                  <option value="RECOUPMENT">RECOUPMENT</option>
                  <option value="TIERED_CUMULATIVE">TIERED_CUMULATIVE</option>
                  <option value="CAP">CAP</option>
                  <option value="FLOOR">FLOOR</option>
                  <option value="RESERVE">RESERVE</option>
                </select>
              </div>

              <div className="field">
                <label>Beneficiary Key</label>
                <input
                  type="text"
                  className="input"
                  value={editForm.beneficiaryKey}
                  onChange={(e) => setEditForm({ ...editForm, beneficiaryKey: e.target.value })}
                  placeholder="e.g. artist, producer, charity"
                />
              </div>
            </div>

            <div className="grid-3">
              <div className="field">
                <label>Waterfall Base</label>
                <select
                  className="input"
                  value={editForm.base}
                  onChange={(e) => setEditForm({ ...editForm, base: e.target.value })}
                >
                  <option value="REMAINDER">REMAINDER (Residual)</option>
                  <option value="NET_REVENUE">NET_REVENUE</option>
                  <option value="GROSS_REVENUE">GROSS_REVENUE</option>
                </select>
              </div>

              <div className="field">
                <label>Rate (Basis Points)</label>
                <input
                  type="number"
                  className="input"
                  value={editForm.rateBasisPoints}
                  onChange={(e) => setEditForm({ ...editForm, rateBasisPoints: e.target.value })}
                  placeholder="1500 = 15%"
                />
              </div>

              <div className="field">
                <label>Priority Rank</label>
                <input
                  type="number"
                  className="input"
                  value={editForm.priority}
                  onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                  placeholder="e.g. 10"
                />
              </div>
            </div>

            {/* Custom Mathematical Formula Field */}
            <div className="field" style={{ marginTop: 10 }}>
              <label style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Mathematical Formula (AST Evaluated)</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Variables: net_revenue, revenue, cumulative_revenue, recoupment_remaining
                </span>
              </label>
              <input
                type="text"
                className="input"
                style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}
                value={editForm.formula}
                onChange={(e) => setEditForm({ ...editForm, formula: e.target.value })}
                placeholder="e.g. max(25000, net_revenue * 0.18)"
              />
            </div>

            <div className="field">
              <label>Formula Explanation (Human-Readable)</label>
              <input
                type="text"
                className="input"
                value={editForm.formulaExplanation}
                onChange={(e) => setEditForm({ ...editForm, formulaExplanation: e.target.value })}
                placeholder="e.g. 18% royalty with a $250.00 guaranteed floor per settlement"
              />
            </div>

            {/* LIVE FORMULA SANDBOX TESTER */}
            {editForm.formula && (
              <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: 14, margin: "14px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 12, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Calculator size={13} color="var(--accent-primary)" />
                    Interactive Formula Sandbox Tester:
                  </strong>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {validateFormulaSyntax(editForm.formula).valid ? "Syntax Valid" : "Invalid Syntax"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Test Revenue:</div>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 120, padding: "4px 8px", fontSize: 12 }}
                    value={testRevenue}
                    onChange={(e) => setTestRevenue(Number(e.target.value))}
                  />
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Computed Output:</div>
                  <strong style={{ fontSize: 14, color: "var(--badge-green-text)", fontFamily: "var(--font-mono)" }}>
                    {formatMoney(
                      evaluateFormula(editForm.formula, {
                        net_revenue: testRevenue,
                        revenue: testRevenue,
                        gross_revenue: testRevenue,
                        cumulative_revenue: testRevenue * 5,
                        recoupment_remaining: 10000,
                      })
                    )}
                  </strong>
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" onClick={() => setEditingRule(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handleSaveEdit} disabled={savingEdit} className="btn btn-primary">
                {savingEdit ? "Saving..." : "Save Rule Updates"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: INLINE AI RULE CO-PILOT CHAT */}
      {chatRule && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 540 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Bot size={18} color="var(--accent-primary)" />
                <h3 style={{ margin: 0, fontSize: 17 }}>AI Rule Co-Pilot</h3>
              </div>
              <button onClick={() => setChatRule(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
              Target Rule: <strong>{chatRule.rule_type}</strong> for <strong>{chatRule.beneficiary_key || "unassigned"}</strong>
            </div>

            {/* Chat Messages */}
            <div style={{ minHeight: 180, maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, paddingRight: 4 }}>
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    background: m.role === "user" ? "var(--accent-primary)" : "var(--bg-elevated)",
                    color: m.role === "user" ? "#ffffff" : "var(--text-primary)",
                    padding: "10px 14px",
                    borderRadius: 12,
                    maxWidth: "85%",
                    fontSize: 12,
                    lineHeight: 1.5,
                    border: `1px solid ${m.role === "user" ? "transparent" : "var(--border-subtle)"}`,
                  }}
                >
                  <div>{m.text}</div>
                  {m.patch && (
                    <div style={{ marginTop: 8, padding: 8, background: "rgba(0,0,0,0.15)", borderRadius: 6, fontSize: 11 }}>
                      <strong>Suggested Changes:</strong>
                      {m.patch.config?.formula && (
                        <div style={{ marginTop: 4 }}>
                          Formula: <code style={{ color: "#34d399", fontWeight: 700 }}>{m.patch.config.formula}</code>
                        </div>
                      )}
                      {m.patch.rateBasisPoints && (
                        <div>Rate: {formatRate(m.patch.rateBasisPoints)}</div>
                      )}
                      <button
                        onClick={() => handleApplyAiPatch(m.patch!)}
                        className="btn btn-primary"
                        style={{ marginTop: 8, padding: "4px 10px", fontSize: 11, width: "100%" }}
                      >
                        <Check size={12} /> Apply AI Adjustments
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div style={{ alignSelf: "flex-start", background: "var(--bg-elevated)", padding: "10px 14px", borderRadius: 12, fontSize: 12, color: "var(--text-muted)" }}>
                  Analyzing contract terms and synthesizing formula...
                </div>
              )}
            </div>

            <form onSubmit={handleSendChatMessage} style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="input"
                style={{ flex: 1 }}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask AI to adjust rate, rewrite formula, or apply clause..."
              />
              <button type="submit" disabled={chatLoading || !chatInput.trim()} className="btn btn-primary">
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: MANUAL HUMAN RULE CREATION */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Author Custom Contract Rule</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateManualRule}>
              <div className="grid-2">
                <div className="field">
                  <label>Rule Type</label>
                  <select
                    className="input"
                    value={addForm.ruleType}
                    onChange={(e) => setAddForm({ ...addForm, ruleType: e.target.value })}
                  >
                    <option value="FORMULA">FORMULA (Dynamic Mathematical Math)</option>
                    <option value="PERCENTAGE">PERCENTAGE</option>
                    <option value="FIXED_AMOUNT">FIXED_AMOUNT</option>
                    <option value="RECOUPMENT">RECOUPMENT</option>
                    <option value="TIERED_CUMULATIVE">TIERED_CUMULATIVE</option>
                    <option value="RESERVE">RESERVE</option>
                  </select>
                </div>

                <div className="field">
                  <label>Payee / Beneficiary Key</label>
                  <input
                    type="text"
                    className="input"
                    value={addForm.beneficiaryKey}
                    onChange={(e) => setAddForm({ ...addForm, beneficiaryKey: e.target.value })}
                    placeholder="e.g. lead_artist, distributor, creator"
                    required
                  />
                </div>
              </div>

              <div className="grid-3">
                <div className="field">
                  <label>Waterfall Base</label>
                  <select
                    className="input"
                    value={addForm.base}
                    onChange={(e) => setAddForm({ ...addForm, base: e.target.value })}
                  >
                    <option value="REMAINDER">REMAINDER (Residual)</option>
                    <option value="NET_REVENUE">NET_REVENUE</option>
                    <option value="GROSS_REVENUE">GROSS_REVENUE</option>
                  </select>
                </div>

                <div className="field">
                  <label>Rate (Basis Points)</label>
                  <input
                    type="number"
                    className="input"
                    value={addForm.rateBasisPoints}
                    onChange={(e) => setAddForm({ ...addForm, rateBasisPoints: Number(e.target.value) })}
                    placeholder="1500 = 15%"
                  />
                </div>

                <div className="field">
                  <label>Priority Rank</label>
                  <input
                    type="number"
                    className="input"
                    value={addForm.priority}
                    onChange={(e) => setAddForm({ ...addForm, priority: Number(e.target.value) })}
                    placeholder="10"
                  />
                </div>
              </div>

              <div className="field">
                <label>Mathematical Formula</label>
                <input
                  type="text"
                  className="input"
                  style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}
                  value={addForm.formula}
                  onChange={(e) => setAddForm({ ...addForm, formula: e.target.value })}
                  placeholder="e.g. net_revenue * 0.15"
                />
              </div>

              <div className="field">
                <label>Formula Explanation</label>
                <input
                  type="text"
                  className="input"
                  value={addForm.formulaExplanation}
                  onChange={(e) => setAddForm({ ...addForm, formulaExplanation: e.target.value })}
                  placeholder="e.g. 15% royalty on residual receipts"
                />
              </div>

              <div className="field">
                <label>Contract Source Reference / Clause</label>
                <input
                  type="text"
                  className="input"
                  value={addForm.clause}
                  onChange={(e) => setAddForm({ ...addForm, clause: e.target.value })}
                  placeholder="e.g. Addendum 1, Section 2.3"
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create & Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
