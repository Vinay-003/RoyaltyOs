import React, { useEffect, useState } from "react";
import { useApp } from "../lib/context.tsx";
import { api, withStepUp, showToast } from "../lib/api.ts";
import { formatMoney, formatRate } from "../lib/format.ts";
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
}

interface ContractAnalysisDetail {
  workspaceId: string;
  version: { id: string; version: number; title: string } | null;
  analysis: { id: string; status: string; warnings?: string[]; conflicts?: any[] } | null;
  rules: CandidateRule[];
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
          rules: prev.rules.map((r) => (r.id === ruleId ? { ...r, status: action === "APPROVE" ? "APPROVED" : "REJECTED" } : r)),
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

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Contract Intelligence</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
          Upload an immutable PDF agreement, extract candidate rules with source grounding, and activate verified RuleSets.
        </p>
      </div>

      <div className="grid-2">
        {/* Left Card: Agreements List */}
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Agreement Versions</h3>
              <p className="card-sub">Manage contractual instruments for this project</p>
            </div>
          </div>

          <form onSubmit={handleCreateContract} style={{ marginBottom: 16 }}>
            <div className="field">
              <label>Agreement Title</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Master Royalty Agreement"
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-secondary">
                  Create
                </button>
              </div>
            </div>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {contracts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`btn ${c.id === selectedId ? "btn-primary" : "btn-secondary"}`}
                style={{ justifyContent: "space-between", padding: "10px 14px", width: "100%" }}
              >
                <span>{c.title}</span>
                <span className={`badge ${c.status === "ACTIVE" ? "badge-green" : "badge-neutral"}`}>
                  {c.status}
                </span>
              </button>
            ))}
            {contracts.length === 0 && !loading && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                No agreements created yet. Enter a title above to begin.
              </div>
            )}
          </div>
        </section>

        {/* Right Card: PDF Upload & AI Execution */}
        <section className="card">
          <div className="card-header">
            <div>
              <h3 className="card-title">
                {detail?.version ? `Contract Document (v${detail.version.version})` : "Upload Document"}
              </h3>
              <p className="card-sub">Private Supabase Storage · SHA-256 sealed</p>
            </div>
            {detail?.analysis && (
              <span className={`badge ${detail.analysis.status === "APPROVED" ? "badge-green" : "badge-amber"}`}>
                {detail.analysis.status}
              </span>
            )}
          </div>

          <div
            style={{
              border: "1.5px dashed var(--border-card)",
              borderRadius: "var(--radius-md)",
              padding: 24,
              textAlign: "center",
              background: "var(--bg-input)",
              marginBottom: 16,
            }}
          >
            <UploadCloud size={32} color="var(--accent-primary)" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {selectedFile ? selectedFile.name : "Select or drag contract PDF here"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              Max 10 MB · Valid PDF document layer required
            </div>
            <input
              type="file"
              accept="application/pdf,.pdf"
              id="contractFileInput"
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
              }}
            />
            <label htmlFor="contractFileInput" className="btn btn-secondary" style={{ cursor: "pointer" }}>
              Browse Files
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={handleUploadPdf}
              disabled={!selectedFile || uploading}
              className="btn btn-primary"
            >
              {uploading ? "Uploading..." : "Upload Sealed Version"}
            </button>
            {detail?.version && (
              <button
                onClick={handleRunAi}
                disabled={analyzing}
                className="btn btn-secondary"
                style={{ display: "inline-flex", gap: 6 }}
              >
                <Sparkles size={14} color="#60a5fa" />
                {analyzing ? "Extracting..." : "Run AI Extraction"}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Human Rule Review Section */}
      {detail?.analysis && (
        <section className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", fontWeight: 700 }}>
                Human-in-the-Loop Review
              </div>
              <h3 className="card-title" style={{ marginTop: 4 }}>
                {detail.rules.length} Candidate Rule(s) Extracted
              </h3>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleApproveAll} className="btn btn-secondary">
                Approve All Pending
              </button>
              <button
                onClick={handleActivateRuleSet}
                disabled={activating || detail.rules.some((r) => r.status === "PENDING" || r.status === "REVIEW_REQUIRED")}
                className="btn btn-primary"
              >
                <FileCheck2 size={14} />
                {activating ? "Activating..." : "Activate approved RuleSet"}
              </button>
            </div>
          </div>

          {detail.analysis.warnings && detail.analysis.warnings.length > 0 && (
            <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} /> Warnings Detected During Extraction:
              </div>
              <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 11, color: "var(--text-secondary)" }}>
                {detail.analysis.warnings.map((w, idx) => (
                  <li key={idx}>{typeof w === "string" ? w : JSON.stringify(w)}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {detail.rules.map((rule) => {
              const statusColor =
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
                      <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
                        {rule.beneficiary_key ? rule.beneficiary_key.replace(/_/g, " ").toUpperCase() : "Waterfall Obligation"}
                      </strong>
                    </div>
                    <span className={`badge ${statusColor}`}>{rule.status}</span>
                  </div>

                  <div className="rule-meta">
                    <span>Rate: <strong style={{ color: "#fff" }}>{formatRate(rule.rate_basis_points)}</strong></span>
                    <span>Fixed: <strong style={{ color: "#fff" }}>{formatMoney(rule.fixed_minor)}</strong></span>
                    <span>Priority: <strong style={{ color: "#fff" }}>{rule.priority}</strong></span>
                    <span>Base: <strong style={{ color: "#60a5fa" }}>{rule.base}</strong></span>
                    {rule.config?.advanceMinor && (
                      <span>Advance: <strong style={{ color: "#fff" }}>{formatMoney(rule.config.advanceMinor)}</strong></span>
                    )}
                    {rule.config?.preRecoupmentBasisPoints && (
                      <span>Pre-Recoupment: <strong style={{ color: "#fff" }}>{formatRate(rule.config.preRecoupmentBasisPoints)}</strong></span>
                    )}
                  </div>

                  {rule.config?.tiers && Array.isArray(rule.config.tiers) && (
                    <div style={{ background: "rgba(255,255,255,0.03)", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 11 }}>
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
                          style={{ padding: "4px 10px", fontSize: 11, borderColor: "rgba(16,185,129,0.3)", color: "#34d399" }}
                        >
                          <CheckCircle size={13} /> Approve
                        </button>
                        <button
                          onClick={() => handleReviewRule(rule.id, "REJECT")}
                          className="btn btn-danger"
                          style={{ padding: "4px 10px", fontSize: 11 }}
                        >
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
