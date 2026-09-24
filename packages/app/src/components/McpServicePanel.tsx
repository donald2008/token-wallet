/**
 * 设置页 MCP 服务区块(D-055 / t_4bd214de):
 * 状态探测 + 一键启停 + 开机自启(Q1 联动) + API Key 复制/重生成 + 复制引导链接(OB-03)。
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
import type { ReactNode } from "react";
import { t } from "../i18n";
import {
  maskMcpKey,
  mcpCheckVersion,
  mcpGenKey,
  mcpGetAutostart,
  mcpGetConfig,
  mcpProbe,
  mcpRestart,
  mcpSetAutostart,
  mcpStart,
  mcpStop,
  type McpConfigView,
  type McpDaemonVersionView,
} from "../ipc";

type Status = "loading" | "running" | "stopped" | "not_installed";

/**
 * MCP daemon 启动成功事件(t_6eb3e728 ①):
 * start/restart 成功后 dispatch window 事件 — App.tsx 监听后置 pending + 立即重拉
 * usage_summary(不等 30s tick), 主页 Agent 区「正在连接 MCP daemon…」→ 数据平滑过渡。
 * window 级 CustomEvent 是 McpServicePanel(设置页) 与 App(主页) 之间既有解耦通道形态,
 * 无新增 IPC(两组件同在 renderer, 无需跨进程)。
 */
function dispatchMcpStarted(): void {
  window.dispatchEvent(new CustomEvent("tw-mcp-started"));
}

export function McpServicePanel(): ReactNode {
  const [status, setStatus] = useState<Status>("loading");
  const [config, setConfig] = useState<McpConfigView | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | "genKey" | "autostart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // OB-03: 引导链接复制成功的瞬态反馈(与 key 复制同款 1.5s)
  // P2-2(review #1683): 主钮/内联钮各自独立瞬态, 修文案串扰
  const [guideCopied, setGuideCopied] = useState(false);
  // 9/24 老大反馈: 复制语义有歧义 — 复制成功后补「发给 agent」提示(瞬态 toast 行)
  const [toast, setToast] = useState<string | null>(null);
  // 服务地址行内联钮复制 endpoint 本体(原误复制 guide — 与行标签语义冲突)
  const [endpointCopied, setEndpointCopied] = useState(false);
  // 重生成 key 时的二次确认(避免误点导致已配 agent 失联)
  const [confirmGenKey, setConfirmGenKey] = useState(false);
  // 重生成 key 后短时提示
  const [genKeyHint, setGenKeyHint] = useState<false | "manual" | "auto" | "failed">(false);
  // t_1b396e2f: daemon 与本机 exe 版本不一致(get_config 已并入比对结果)
  const [staleVersion, setStaleVersion] = useState<McpDaemonVersionView | null>(null);

  const probe = useCallback(async () => {
    // ⚠️ 不要无条件 setError(null): 操作流的错误(start/stop/genKey 失败)会被下次 probe 抹掉
    // 只在用户主动重试时(probe 不在错误恢复路径)清空; 此处保留 error, 由操作路径自己清
    const [r, c, a] = await Promise.all([mcpProbe(), mcpGetConfig(), mcpGetAutostart()]);
    // OB-03: 桥/降级路径可能返 null(config 缺失) — probe 不得因此崩, 复制钮已按 !config 守卫
    setConfig(c ?? null);
    setAutostart(a.mcpAutostart);
    // t_1b396e2f: get_config 已并入 build_id 比对 — daemon 陈旧(含 daemon 侧无字段而本机 exe 有)
    // 或因 restart 收敛后单点复查结果不一致时更新
    if (c?.daemonVersion?.stale) {
      const recheck = await mcpCheckVersion();
      setStaleVersion(recheck.stale ? recheck : null);
    } else {
      setStaleVersion(null);
    }
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
      } else {
        // t_6eb3e728 ①: 启动成功 → App 置 pending + 立即重拉 usage_summary(不等 30s tick)
        dispatchMcpStarted();
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
      // t_1b396e2f: 不传 pid — 主进程 lastStartedPid 快路径 + **端口归属反查**兜底(netstat/ss),
      // app 重启后缓存丢失也能真停; 只有反查都失败(权限/命令异常)才显式报 discovery_failed。
      const r = await mcpStop();
      if (!r.stopped) {
        // stop 失败必须可见, 不许静默吞
        setError(t("set.mcpErrorGeneric", { msg: r.reason ?? "stop_failed" }));
      }
      await probe();
    } finally {
      setBusy(null);
    }
  };

  // t_1b396e2f: 陈旧 daemon 一键收敛 — restart 编排已改为先真停(端口反查)后起
  const onConverge = async () => {
    if (busy) return;
    setBusy("start");
    setError(null);
    try {
      const r = await mcpRestart();
      if (!r.started) {
        setError(t("set.mcpErrorGeneric", { msg: r.reason ?? "restart_failed" }));
      } else {
        // t_6eb3e728 ①: restart 收敛成功同样触发立即重拉(旧 daemon 数据可能已变)
        dispatchMcpStarted();
      }
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
      // t_4bd214de round-2 BLOCKING-1: key regen 后 daemon 持旧 key, 新 key 不生效 —
      // 必须真实编排 restart: 主进程 mcp_restart 通道用缓存 lastStartedPid 停 + 起,
      // 完成后 daemon 才读 mcp.env 拿新 key。daemon 未跑 → 只写盘, 提示用户手动 start。
      const wasAlive = r.daemonWasRunning;
      let restartOk = false;
      if (wasAlive) {
        const rr = await mcpRestart();
        restartOk = rr.started;
        if (!rr.started) {
          setError(t("set.mcpErrorGeneric", { msg: rr.reason ?? "restart_failed" }));
        }
      }
      // 选 hint 文案: 三态 — 未跑 / 自动重启成功 / 自动重启失败
      setGenKeyHint(!wasAlive ? "manual" : restartOk ? "auto" : "failed");
      setTimeout(() => setGenKeyHint(false), 4000);
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

  // t_da2fd1f1 U6: 显示地址由主进程解析 — 通配 bind(0.0.0.0/::)展示局域网 IPv4,
  // 否则原样(127.0.0.1 等维持现状); browser 降级时兜底 127.0.0.1
  const endpoint = config
    ? (config.displayEndpoint ??
      `http://${config.TOKEN_WALLET_HOST}:${config.TOKEN_WALLET_PORT}/mcp`)
    : "http://127.0.0.1:9131/mcp";

  // OB-03(SC-03): 引导链接与 endpoint 同源解析 — host 继承 displayEndpoint 的
  // 局域网语义(H3/U6: 通配 bind 已被主进程解析为局域网 IPv4), 仅 path 换 /guide。
  // S9 修订: daemon 离线也不做静态兜底 — 复制 URL 即引导语义的全部, agent 拿链接自适配。
  const guideUrl = endpoint.replace(/\/mcp$/, "/guide");

  // 统一复制 + 瞬态 toast(1.5s「已复制」钮文案 & 面板 toast 行双反馈)
  const copyWith = async (text: string, done: () => void, toastMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      done();
      setToast(toastMsg);
      setTimeout(() => setToast(null), 2600);
    } catch {
      setError(t("set.mcpErrorGeneric", { msg: "clipboard denied" }));
    }
  };

  const onCopyGuide = async (_which: "main" | "icon" = "main") => {
    await copyWith(guideUrl, () => {
      setGuideCopied(true);
      setTimeout(() => setGuideCopied(false), 1500);
    }, t("set.mcpGuideCopiedToast"));
  };

  const onCopyEndpoint = async () => {
    await copyWith(endpoint, () => {
      setEndpointCopied(true);
      setTimeout(() => setEndpointCopied(false), 1500);
    }, t("set.mcpEndpointCopiedToast"));
  };

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
          data-testid="mcp-copy-guide"
          disabled={!config}
          onClick={() => void onCopyGuide("main")}
        >
          {guideCopied ? t("set.mcpGuideLinkCopied") : t("set.mcpCopyGuideLink")}
        </button>
      </div>

      {/* 9/24 老大反馈: 常驻引导提示 — 告诉用户复制后「怎么用」(发给 agent), 消除按钮语义歧义 */}
      <p className="hint" data-testid="mcp-guide-hint">{t("set.mcpGuideHint")}</p>

      {/* 复制成功的瞬态 toast(2.6s) — 「已复制」之外把下一步动作说明白 */}
      {toast && (
        <p className="mcp-toast" data-testid="mcp-toast" role="status">
          {toast}
        </p>
      )}

      {staleVersion && status === "running" && (
        <div className="mcp-confirm" data-testid="mcp-stale-warning">
          <div className="mcp-confirm-body">
            <h4>{t("set.mcpStaleTitle")}</h4>
            <p>{t("set.mcpStaleBody")}</p>
            <div className="mcp-confirm-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="mcp-stale-restart"
                disabled={busy !== null}
                onClick={() => void onConverge()}
              >
                {busy === "start" ? t("set.mcpRestarting") : t("set.mcpStaleRestartAction")}
              </button>
            </div>
          </div>
        </div>
      )}

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
          <dd className="mcp-key-row">
            <code data-testid="mcp-endpoint">{endpoint}</code>
            <button
              type="button"
              className="btn btn-icon"
              data-testid="mcp-endpoint-copy"
              aria-label={t("set.mcpEndpointCopy")}
              disabled={!config}
              onClick={() => void onCopyEndpoint()}
            >
              {endpointCopied ? t("set.mcpGuideLinkCopied") : t("set.mcpEndpointCopy")}
            </button>
          </dd>
        </div>
        <div className="mcp-info-row mcp-guide-url-row">
          <dt>{t("set.mcpGuideRowLabel")}</dt>
          <dd className="mcp-key-row">
            <code data-testid="mcp-guide-url">{guideUrl}</code>
            <button
              type="button"
              className="btn btn-icon"
              data-testid="mcp-guide-copy"
              aria-label={t("set.mcpCopyGuideLink")}
              disabled={!config}
              onClick={() => void onCopyGuide("icon")}
            >
              {guideCopied ? t("set.mcpGuideLinkCopied") : t("set.mcpGuideCopy")}
            </button>
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
          {t(
            genKeyHint === "auto"
              ? "set.mcpKeyRegenAutoRestartHint"
              : genKeyHint === "failed"
                ? "set.mcpKeyRegenRestartFailedHint"
                : "set.mcpKeyRegenRestartHint",
          )}
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
