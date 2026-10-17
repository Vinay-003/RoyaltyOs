import React, { useEffect, useState } from "react";
import { registerToastHandler } from "../lib/api.ts";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

interface ToastState {
  id: number;
  message: string;
  type: "info" | "success" | "error" | "warn";
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  useEffect(() => {
    registerToastHandler((message, type = "info") => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => {
        const bg = t.type === "success" ? "#064e3b" : t.type === "error" ? "#450a0a" : t.type === "warn" ? "#451a03" : "#1e293b";
        const border = t.type === "success" ? "#059669" : t.type === "error" ? "#dc2626" : t.type === "warn" ? "#d97706" : "#334155";
        const icon = t.type === "success" ? <CheckCircle2 size={16} color="#34d399" /> : t.type === "error" ? <AlertCircle size={16} color="#f87171" /> : t.type === "warn" ? <AlertTriangle size={16} color="#fbbf24" /> : <Info size={16} color="#94a3b8" />;

        return (
          <div
            key={t.id}
            style={{
              background: bg,
              border: `1px solid ${border}`,
              color: "#fff",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
              maxWidth: 380,
            }}
          >
            {icon}
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
