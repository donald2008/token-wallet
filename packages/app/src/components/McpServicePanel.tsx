/**
 * 设置页 MCP 服务区块(D-048 / t_4bd214de):
 * 状态探测 + 一键启停 + 开机自启(Q1 联动) + API Key 复制/重生成 + 引导入口。
 *
 * 设计: 独立组件, 由 SettingsView.tsx 嵌入 <section className="settings-section">,
 * 自身不持有 settings section chrome。单一职责 = MCP 区块状态机。
 *
 * 状态机:
 *   loading → idle(probe 完成)
 *   probe.alive → "running"
 *   probe.!alive + installed → "stopped"
 *   probe.!alive + !installed → "not_installed"
 *   操作中(start/stop/genKey) → "busy", 期间禁用所有控件
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import {
  maskMcpKey,
  mcpGenKey,
  mcpGetAutostart,
  mcpGetConfig,
  mcpProbe,
  mcpSetAutostart,
  mcpStart,
  mcpStop,
  type McpConfigView,
} from "../ipc";

type Status = "loading" | "running" | "stopped" | "not_installed";

interface Props {
  /** 进入设置页时探一次 + app 启动探一次; onChange 留给父级做刷新钩 */
  onGuideOpen: () => void;
}

export function McpServicePanel({ onGuideOpen }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [config, setConfig] = useState<McpConfigView | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | "genKey" | "autostart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 重生成 key 时的二次确认(避免误点导致已配 agent 失联)
  const [confirmGenKey, setConfirmGenKey] = useState(false);
  // 重生成 key 后短时提示
  const [genKeyHint, setGenKeyHint] = useState(false);

  const probe = useCallback(async () => {
    // ⚠️ 不要无条件 setError(null): 操作流的错误(start/stop/genKey 失败)会被下次 probe 抹掉
    // 只在用户主动重试时(probe 不在错误恢复路径)清空; 此处保留 error, 由操作路径自己清
    const [r, c, a] = await Promise.all([mcpProbe(), mcpGetConfig(), mcpGetAutostart()]);
    setConfig(c);
    setAutostart(a.mcpAutostart);
    if (!r.installed) setStatus("not_installed");
    else if (r.alive) setStatus("running");
    else setStatus("stopped");
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const onStart = async () => {
    if (busy) return;
    setBusy("start");
    setError(null);
    try {
      const r = await mcpStart();
      if (!r.started) {
        setError(t("set.mcpErrorGeneric", { msg: r.reason ?? "unknown" }));
      }
      await probe();
    } finally {
      setBusy(null);
    }
  };

  const onStop = async () => {
    if (busy) return;
    setBusy("stop");
    setError(null);
    try {
      // 后端无 pid 持有时 mcpStop 会返 stopped:false reason=pid_required;
      // UI 走"先 stop(无 pid 试探), 失败再 mcpStart() 后立即 mcpStop() 强制覆盖" 不必要 —
      // 真 daemon 由 mcpStart 返回 pid, 此处先读 config 没 pid 字段, 简化: 调 mcpStop 不传 pid
      // 后端会做 probe 反推, 若 daemon 在跑返 pid_required, UI 提示"重启请先 start 后再 stop"
      await mcpStop();
      await probe();
    } finally {
      setBusy(null);
    }
  };

  const onToggleAutostart = async (next: boolean) => {
    if (busy) return;
    setBusy("autostart");
    setError(null);
    try {
      const r = await mcpSetAutostart(next);
      setAutostart(r.mcpAutostart);
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(config.TOKEN_WALLET_MCP_KEY);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t("set.mcpErrorGeneric", { msg: "clipboard denied" }));
    }
  };

  const onRegen = async () => {
    if (busy) return;
    setBusy("genKey");
    setError(null);
    try {
      const r = await mcpGenKey();
      // 立即重读 config 拿新 key(后端已 atomic 写)
      const fresh = await mcpGetConfig();
      setConfig(fresh);
      setGenKeyHint(true);
      setTimeout(() => setGenKeyHint(false), 4000);
      void r; // daemonWasRunning 字段留作未来 toast 用
    } finally {
      setBusy(null);
      setConfirmGenKey(false);
    }
  };

  const statusLabel = (s: Status): string => {
    if (s === "running") return t("set.mcpStatusRunning");
    if (s === "stopped") return t("set.mcpStatusStopped");
    if (s === "not_installed") return t("set.mcpStatusNotInstalled");
    return t("set.mcpStatusProbe");
  };

  const endpoint = config
    ? `http://${config.TOKEN_WALLET_HOST}:${config.TOKEN_WALLET_PORT}/mcp`
    : "http://127.0.0.1:9131/mcp";

  return (
    <div className="mcp-panel" data-testid="mcp-panel" data-status={status}>
      <div className="mcp-row">
        <span className="mcp-status-dot" data-status={status} aria-hidden="true" />
        <span className="mcp-status-label" data-testid="mcp-status">
          {statusLabel(status)}
        </span>
        <span className="mcp-subtitle">{t("set.mcpSubtitle")}</span>
      </div>

      <div className="mcp-row mcp-actions" data-testid="mcp-actions">
        <button
          type="button"
          className="btn"
          data-testid="mcp-start"
          disabled={busy !== null || status === "running" || status === "loading" || status === "not_installed"}
          onClick={() => void onStart()}
        >
          {busy === "start" ? t("set.mcpRestarting") : t("set.mcpStart")}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="mcp-stop"
          disabled={busy !== null || status !== "running"}
          onClick={() => void onStop()}
        >
          {busy === "stop" ? t("set.mcpRestarting") : t("set.mcpStop")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="mcp-open-guide"
          onClick={onGuideOpen}
        >
          {t("set.mcpAgentOpenGuide")}
        </button>
      </div>

      <div className="mcp-row mcp-autostart-row">
        <label className="check-row">
          <input
            type="checkbox"
            data-testid="mcp-autostart"
            checked={autostart}
            disabled={busy !== null}
            onChange={(e) => void onToggleAutostart(e.currentTarget.checked)}
          />
          <span>{t("set.mcpAutostartLabel")}</span>
        </label>
        <p className="hint">{t("set.mcpAutostartHint")}</p>
      </div>

      <dl className="mcp-info">
        <div className="mcp-info-row">
          <dt>{t("set.mcpEndpointLabel")}</dt>
          <dd>
            <code data-testid="mcp-endpoint">{endpoint}</code>
          </dd>
        </div>
        <div className="mcp-info-row">
          <dt>{t("set.mcpKeyLabel")}</dt>
          <dd className="mcp-key-row">
            <code data-testid="mcp-key-masked">
              {config ? maskMcpKey(config.TOKEN_WALLET_MCP_KEY) : "••••••"}
            </code>
            <button
              type="button"
              className="btn btn-icon"
              data-testid="mcp-key-copy"
              aria-label={t("set.mcpKeyCopy")}
              disabled={!config}
              onClick={() => void onCopy()}
            >
              {copied ? t("set.mcpKeyCopied") : t("set.mcpKeyCopy")}
            </button>
            <button
              type="button"
              className="btn btn-icon"
              data-testid="mcp-key-regen"
              disabled={busy !== null}
              onClick={() => setConfirmGenKey(true)}
            >
              {t("set.mcpKeyRegen")}
            </button>
          </dd>
        </div>
      </dl>

      {confirmGenKey && (
        <div className="mcp-confirm" data-testid="mcp-regen-confirm-panel">
          <div className="mcp-confirm-body">
            <h4>{t("set.mcpKeyRegenConfirmTitle")}</h4>
            <p>{t("set.mcpKeyRegenConfirmBody")}</p>
            <div className="mcp-confirm-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="mcp-regen-confirm"
                onClick={() => void onRegen()}
              >
                {t("set.mcpKeyRegenConfirm")}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="mcp-regen-cancel"
                onClick={() => setConfirmGenKey(false)}
              >
                {t("set.mcpKeyRegenCancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {genKeyHint && (
        <p className="mcp-hint" data-testid="mcp-regen-hint">
          {t("set.mcpKeyRegenRestartHint")}
        </p>
      )}

      {error && (
        <p className="mcp-error" data-testid="mcp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
