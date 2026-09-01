import { useRef, useState } from "react";
import type { ProviderSnapshot } from "../types";
import { providerHealth, statusBadge } from "../health";
import { getTemplateFor } from "../templates/registry";
import { t } from "../i18n";
import { BrandLogo } from "./brand-logos";
import type { DragHandleProps } from "../useCardDragSort";
import { commandAuthCancel, commandAuthFinish, commandAuthStart } from "../ipc";

/**
 * 从 setup_hint 提取可复制的完整命令原文(契约4): 提取首个 `…` 反引号包裹段;
 * 无反引号时退回整个 hint(hint 全文也可复制, 比没得复制强)。
 * core 侧既有形态: "运行 `bl auth login --console` 重新授权(控制台会话由 CLI 管理)"。
 */
export function extractCommandFromHint(hint: string): string {
  const m = /`([^`]+)`/.exec(hint);
  return m?.[1]?.trim() || hint.trim();
}

/** 复制到剪贴板: navigator.clipboard 优先, Electron 壳内失败(file:// 等)降级 execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** setup_hint 复制小钮(契约4): 成功反馈「已复制」1.5s 后还原 */
function HintCopyButton({ hint }: { hint: string }) {
  const [copied, setCopied] = useState(false);
  const command = extractCommandFromHint(hint);
  const onCopy = () => {
    void copyText(command).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      className="btn btn-sm hint-copy-btn"
      data-testid="hint-copy-btn"
      data-copied={copied}
      title={t("card.copyCmdTitle", { cmd: command })}
      aria-label={copied ? t("card.copied") : t("card.copyCmdAria", { cmd: command })}
      onClick={onCopy}
    >
      {copied ? t("card.copied") : t("card.copy")}
    </button>
  );
}

/**
 * t_fb8c44d8: command 通道一键授权(autopay 2026-09-01)。
 * 消灭「开终端跑命令」: 点「一键授权」→ 主进程 spawn auth login 取 URL 自动开浏览器 → 按协议完成:
 * - finishMode="code" (arkcli 设备码): 浏览器页面显示 code → 用户复制 → 输入框粘贴 → 回喂 → 完成
 * - finishMode="callback" (bl localhost 自闭环): 浏览器授权后 CLI 自收 code, **免粘贴**自动等待完成
 * 用户全程不碰命令行。code 粘贴仅 arkcli 协议需要(设备码天花板, 见 auth-session.ts)。
 */
export function extractCliFromHint(hint: string): string {
  const cmd = extractCommandFromHint(hint);
  // 命令首词 = CLI 名(ep: `arkcli auth login …` / `bl auth login --console`)
  return cmd.trim().split(/\s+/)[0] ?? "";
}

function OneClickAuth({ hint }: { hint: string }) {
  const [stage, setStage] = useState<"idle" | "starting" | "waiting" | "done" | "error">("idle");
  const [finishMode, setFinishMode] = useState<"code" | "callback" | undefined>(undefined);
  const [sessionId, setSessionId] = useState("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // 取消/重开时递增, 使 in-flight 的 start/finish promise 回调失效, 防旧结果覆盖新 UI
  const runGen = useRef(0);
  const cli = extractCliFromHint(hint);

  const onStart = () => {
    if (!cli) return;
    const gen = ++runGen.current;
    setStage("starting");
    setErrorMsg("");
    setCode("");
    setFinishMode(undefined);
    void commandAuthStart(cli).then((res) => {
      if (runGen.current !== gen) return; // 已被取消/重开
      if (!res.ok || !res.sessionId) {
        setErrorMsg(res.message ?? "授权启动失败");
        setStage("error");
        return;
      }
      const mode = res.finishMode ?? "code";
      setSessionId(res.sessionId);
      setFinishMode(mode);
      setUrl(res.url ?? "");
      setStage("waiting");
      if (mode === "callback") {
        // bl 自闭环: 浏览器授权后 CLI 自收 code 退出 → 免粘贴, 立即进入等待完成
        void commandAuthFinish(res.sessionId, "").then((fr) => {
          if (runGen.current !== gen) return;
          if (fr.ok) {
            setStage("done");
          } else {
            setErrorMsg(fr.message ?? "授权失败");
            setStage("error");
          }
        });
      }
    });
  };

  const onFinish = () => {
    if (!code.trim()) return;
    const gen = runGen.current;
    setStage("starting");
    setErrorMsg("");
    void commandAuthFinish(sessionId, code.trim()).then((res) => {
      if (runGen.current !== gen) return;
      if (res.ok) {
        setStage("done");
        setCode("");
      } else {
        setErrorMsg(res.message ?? "授权失败");
        setStage("error");
      }
    });
  };

  const onCancel = () => {
    runGen.current += 1; // 使 in-flight 回调失效
    if (sessionId) void commandAuthCancel(sessionId);
    setSessionId("");
    setCode("");
    setStage("idle");
  };

  return (
    <div className="oneclick-auth" data-testid="oneclick-auth">
      {stage === "idle" || stage === "done" ? (
        <button
          type="button"
          className="btn btn-sm oneclick-auth-btn"
          data-testid="oneclick-auth-btn"
          onClick={onStart}
        >
          {stage === "done" ? t("card.authDone") : t("card.authStart")}
        </button>
      ) : null}
      {stage === "starting" ? (
        <span className="oneclick-auth-note" data-testid="oneclick-auth-note">
          {t("card.authWorking")}
        </span>
      ) : null}
      {stage === "waiting" ? (
        <div className="oneclick-auth-panel" data-testid="oneclick-auth-panel">
          <div className="oneclick-auth-head">
            {finishMode === "callback" ? (
              <span>{t("card.authWaitingCallback")}</span>
            ) : (
              <span>{t("card.authBrowserHint")}</span>
            )}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="oneclick-auth-url"
                data-testid="oneclick-auth-url"
              >
                {t("card.authOpenUrl")}
              </a>
            ) : null}
          </div>
          {finishMode === "callback" ? (
            <div className="oneclick-auth-row">
              <button
                type="button"
                className="btn btn-sm oneclick-auth-cancel"
                data-testid="oneclick-auth-cancel"
                onClick={onCancel}
              >
                {t("card.authCancel")}
              </button>
            </div>
          ) : (
            <div className="oneclick-auth-row">
              <input
                className="oneclick-auth-input"
                data-testid="oneclick-auth-code"
                placeholder={t("card.authCodePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onFinish();
                }}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-sm oneclick-auth-confirm"
                data-testid="oneclick-auth-confirm"
                disabled={!code.trim()}
                onClick={onFinish}
              >
                {t("card.authConfirm")}
              </button>
              <button
                type="button"
                className="btn btn-sm oneclick-auth-cancel"
                data-testid="oneclick-auth-cancel"
                onClick={onCancel}
              >
                {t("card.authCancel")}
              </button>
            </div>
          )}
          {errorMsg ? <div className="oneclick-auth-error">{errorMsg}</div> : null}
        </div>
      ) : null}
      {stage === "error" ? (
        <div className="oneclick-auth-error" data-testid="oneclick-auth-error">
          {errorMsg}
          <button
            type="button"
            className="btn btn-sm oneclick-auth-retry"
            data-testid="oneclick-auth-retry"
            onClick={onCancel}
          >
            {t("card.authRetry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 品牌色块(§6.1 第 4 条): 16px 平台识别色 — P1(t_696ec820)起由内置单色 SVG 品牌图标(BrandLogo)取代 */

/** 值为 i18n 键(渲染时经 t() 取文案, D-047) */
const STATUS_TEXT: Record<string, string> = {
  stale: "statusText.stale",
  auth_expired: "statusText.auth_expired",
  unsupported: "statusText.unsupported",
  error: "statusText.error",
};

function agoText(fetchedAt: number): string {
  const s = Math.floor(Date.now() / 1000) - fetchedAt;
  if (s < 60) return t("ago.now");
  if (s < 3600) return t("ago.minutes", { n: Math.floor(s / 60) });
  return t("ago.hours", { n: Math.floor(s / 3600) });
}

/**
 * 异常状态卡(§2.1): status=auth_expired/stale/unsupported/error 时
 * 整卡文字替代图表, 不显示假数据(无进度条/无余额大数字)。
 * - auth_expired: 亮黄灯(§2.1: 登录态失效非配额耗尽) + setup_hint 指引恢复
 * - stale / unsupported: 灰
 * - error: 红
 */
function AbnormalBody({ p }: { p: ProviderSnapshot }) {
  const health = providerHealth(p);
  return (
    <div className="abnormal-body" data-testid="abnormal-body">
      <div className={`card-status-text text-${health}`}>
        {p.status === "auth_expired" && (
          <span className="lamp" data-lamp="auth_expired" title={t("card.lampAuthTitle")} aria-label={t("card.lampAuthAria")}>
            ●
          </span>
        )}
        {STATUS_TEXT[p.status] ? t(STATUS_TEXT[p.status] as Parameters<typeof t>[0]) : p.status}
      </div>
      {p.status === "auth_expired" && p.setup_hint && (
        <div className="setup-hint" data-testid="setup-hint">
          <span className="setup-hint-text">⚑ {p.setup_hint}</span>
          {/* t_66b67453 契约4: 一键复制授权命令(反引号内完整原文), 免手抄易错 */}
          <HintCopyButton hint={p.setup_hint} />
          {/* t_fb8c44d8: command 通道一键授权 — 自动开浏览器 + 粘贴 code 回喂, 消灭开终端 */}
          <OneClickAuth hint={p.setup_hint} />
        </div>
      )}
      <div className="card-error-note">
        {t("card.lastUpdate", { ago: agoText(p.fetched_at) })}
        {p.alerts.length > 0 ? ` — ${p.alerts.map((a) => a.message).join("; ")}` : ""}
        {p.error_message && p.error_message !== p.alerts.map((a) => a.message).join("; ") ? ` · ${p.error_message}` : ""}
      </div>
    </div>
  );
}

/**
 * Provider 卡片。
 *
 * D-038 操作分区: **卡片 = 实例动作** —— head 右上删除钮(hover 卡片淡入),
 * 点击弹既有 confirm-delete 气泡(含取消, 红调), 确认后走 onDelete → store.remove
 * (钥匙串 D-029 + DB 快照清理 t_2ac39613 契约, 全在 store 侧, 本组件不碰持久化)。
 * `onDelete` 未传(dev 场景 mock 预览卡)时不渲染删除钮 —— 不给用户可点但无效的按钮。
 *
 * D-039 拖动排序: head 左侧品牌色块(16px)即**拖动手柄** —— dragHandle 传入时
 * 色块获得 pointer 事件绑定 + grab 光标; dragging 时整卡浮起(transform + shadow)。
 */
export function ProviderCard({
  p,
  onDelete,
  dragHandle,
  dragging = false,
  dragDy = 0,
}: {
  p: ProviderSnapshot;
  /** 传入即渲染卡内删除钮(仅真实实例); 参数 = provider_id(= 实例 id) */
  onDelete?: (id: string) => void;
  /** D-039 拖动手柄绑定(pointer 事件, 由 App useCardDragSort 提供); 传入即色块可拖 */
  dragHandle?: DragHandleProps;
  /** D-039 该卡正在被拖动(浮起视觉) */
  dragging?: boolean;
  /** D-039 拖动中浮起位移(px, 视觉 transform translateY) */
  dragDy?: number;
}) {
  const health = providerHealth(p);
  const Template = getTemplateFor(p).component;
  const [confirming, setConfirming] = useState(false);
  return (
    <section
      className={`card${dragging ? " card-dragging" : ""}`}
      style={dragging ? { transform: `translateY(${dragDy}px)` } : undefined}
      data-testid="provider-card"
      data-provider={p.provider_id}
      data-health={health}
    >
      <div className="card-head">
        <span
          className={`brand-block${dragHandle ? " drag-handle" : ""}`}
          title={dragHandle ? t("card.dragSort", { name: p.display_name }) : p.provider_id}
          data-testid={dragHandle ? `drag-handle-${p.provider_id}` : undefined}
          {...dragHandle}
        >
          {/* P1(t_696ec820): 内置单色 SVG 品牌图标; descriptor.logo 生效(未收录回退品牌色块) */}
          <BrandLogo platform={p.logo ?? p.provider_id} size={16} />
        </span>
        <span className="card-name" title={p.provider_id}>
          {p.display_name}
        </span>
        <span className={`card-status-text text-${health}`}>{statusBadge(p)}</span>
        {onDelete && !confirming && (
          <button
            type="button"
            className="btn btn-icon btn-danger card-del-btn"
            data-testid={`card-del-${p.provider_id}`}
            title={t("card.deleteNamed", { name: p.display_name })}
            aria-label={t("card.deleteNamed", { name: p.display_name })}
            onClick={() => setConfirming(true)}
          >
            {/* 手绘垃圾桶(D-002 不引图标库, 与图钉/侧栏同 stroke 风格) */}
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M3.4 4.6h9.2M6.4 4.6V3.1h3.2v1.5M4.6 4.6l.5 8.3h5.8l.5-8.3M6.8 6.9v4.1M9.2 6.9v4.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {onDelete && confirming && (
          // 确认气泡(沿用设置页 confirm-delete 模式: 文案 + 确认 + 取消, 红调);
          // 绝对定位浮在卡右上, 不挤压 360px 卡头布局
          <span className="confirm-row card-confirm" data-testid={`card-confirm-row-${p.provider_id}`}>
            <span className="confirm-text">{t("card.confirmDelete")}</span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              data-testid={`card-confirm-del-${p.provider_id}`}
              onClick={() => {
                setConfirming(false);
                onDelete(p.provider_id);
              }}
            >
              {t("card.confirm")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              data-testid={`card-cancel-del-${p.provider_id}`}
              onClick={() => setConfirming(false)}
            >
              {t("card.cancel")}
            </button>
          </span>
        )}
      </div>
      {p.status === "ok" ? <Template p={p} /> : <AbnormalBody p={p} />}
    </section>
  );
}
