/**
 * Agent 引导弹窗(D-048 / t_4bd214de Q4 决议 B):
 * 调 GET /guide → 渲染各 agent 接入步骤。React portal 到 document.body(避
 * backdrop root 嵌套, t_c20d4d11 round-3 B3-2 同款), 主题一致。
 *
 * 形态: 简化版(无引 react-i18next 等), 直接 t() + portal。
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { mcpGetGuide, type McpAgentStep } from "../ipc";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AgentGuideModal({ open, onClose }: Props) {
  const [agents, setAgents] = useState<McpAgentStep[]>([]);
  const [reason, setReason] = useState<"daemon_not_running" | "fetch_failed" | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mcpGetGuide();
      setAgents(r.agents as McpAgentStep[]);
      setReason(r.reason ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const body = (
    <div
      className="mcp-guide-overlay"
      data-testid="mcp-guide-overlay"
      role="dialog"
      aria-label={t("set.mcpAgentTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mcp-guide-modal" data-testid="mcp-guide-modal">
        <div className="mcp-guide-head">
          <h3>{t("set.mcpAgentTitle")}</h3>
          <button
            type="button"
            className="btn btn-icon"
            data-testid="mcp-guide-close"
            onClick={onClose}
            aria-label={t("set.closeAria")}
          >
            ×
          </button>
        </div>
        <div className="mcp-guide-body" data-testid="mcp-guide-body">
          {loading && <p data-testid="mcp-guide-loading">{t("set.mcpStatusProbe")}</p>}
          {!loading && reason === "daemon_not_running" && (
            <p data-testid="mcp-guide-empty">{t("set.mcpAgentGuideEmpty")}</p>
          )}
          {!loading && reason === "fetch_failed" && (
            <p data-testid="mcp-guide-failed">{t("set.mcpAgentGuideFailed")}</p>
          )}
          {!loading && !reason && agents.length === 0 && (
            <p data-testid="mcp-guide-empty">{t("set.mcpAgentGuideEmpty")}</p>
          )}
          {!loading && agents.length > 0 && (
            <ul className="mcp-guide-list" data-testid="mcp-guide-list">
              {agents.map((a) => (
                <li key={a.id} className="mcp-guide-item" data-testid={`mcp-guide-${a.id}`}>
                  <h4>{a.name}</h4>
                  {a.plugin_url && (
                    <p>
                      <a href={a.plugin_url} target="_blank" rel="noreferrer">
                        {a.plugin_url}
                      </a>
                    </p>
                  )}
                  {a.docs_url && (
                    <p>
                      <a href={a.docs_url} target="_blank" rel="noreferrer">
                        {a.docs_url}
                      </a>
                    </p>
                  )}
                  {a.configure && (
                    <div className="mcp-guide-step">
                      <strong>{t("set.mcpAgentGuideStep")} 1 · configure</strong>
                      <pre>{a.configure}</pre>
                    </div>
                  )}
                  {a.verify && (
                    <div className="mcp-guide-step">
                      <strong>{t("set.mcpAgentGuideStep")} 2 · verify</strong>
                      <pre>{a.verify}</pre>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
