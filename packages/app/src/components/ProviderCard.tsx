import { useRef, useState } from "react";
import type { ProviderSnapshot } from "../types";
import { providerHealth, statusBadge } from "../health";
import { getTemplateFor } from "../templates/registry";
import { t } from "../i18n";
import { BrandHandle } from "./ProviderCardLayouts";
import { StatusDot } from "./StatusDot";
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

/** t_fb8c44d8 配套: 由 CLI 名 → 安装命令(2026-09-11 真机实证 npm 全局陷阱)。
 * 当前 command 通道: arkcli / bl。arkcli 官方包名 @volcengine/ark-cli; bl 阿里云官方文档明示
 * (此处仅 user-visible copy, 实际安装由用户复制命令到 shell 执行, app 不代装)。 */
const CLI_INSTALL_CMD: Record<string, string> = {
  arkcli: "npm i -g @volcengine/ark-cli",
  bl: "npm i -g @alicloud/bl",
};

function OneClickAuth({ hint, providerId, onRefresh }: { hint: string; providerId: string; onRefresh?: (id: string) => void }) {
  const [stage, setStage] = useState<"idle" | "starting" | "waiting" | "done" | "error">("idle");
  const [finishMode, setFinishMode] = useState<"code" | "callback" | undefined>(undefined);
  const [sessionId, setSessionId] = useState("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  // t_12bdc277 P0 L1: cli_missing 错误分类 — 渲染专属安装引导 vs 通用错误
  const [errorKind, setErrorKind] = useState<"cli_missing" | "exec_error" | undefined>(undefined);
  // t_12bdc277 P0 L2: npm prefix 不在 PATH 时填充, 渲染额外 PowerShell 修复命令
  const [pathHint, setPathHint] = useState<{ npmPrefix: string } | undefined>(undefined);
  // 取消/重开时递增, 使 in-flight 的 start/finish promise 回调失效, 防旧结果覆盖新 UI
  const runGen = useRef(0);
  const cli = extractCliFromHint(hint);

  const onStart = () => {
    if (!cli) return;
    const gen = ++runGen.current;
    setStage("starting");
    setErrorMsg("");
    setErrorKind(undefined);
    setPathHint(undefined);
    setCode("");
    setFinishMode(undefined);
    void commandAuthStart(cli).then((res) => {
      if (runGen.current !== gen) return; // 已被取消/重开
      if (!res.ok || !res.sessionId) {
        setErrorMsg(res.message ?? "授权启动失败");
        setErrorKind(res.kind);
        setPathHint(res.pathHint);
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
            setErrorKind(fr.kind);
            setPathHint(fr.pathHint);
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
    setErrorKind(undefined);
    setPathHint(undefined);
    void commandAuthFinish(sessionId, code.trim()).then((res) => {
      if (runGen.current !== gen) return;
      if (res.ok) {
        setStage("done");
        setCode("");
      } else {
        setErrorMsg(res.message ?? "授权失败");
        setErrorKind(res.kind);
        setPathHint(res.pathHint);
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
          // t_034a6e81 Bug1 修: done 态点击 = 触发该卡刷线(重新采集), 不再走 onStart(避免又开授权页)。
          // onRefresh 未传(mock 预览卡) → done 态按钮禁用, 提示预览卡不可刷新(照 onDelete 不渲染的"不给可点但无效的按钮"精神)
          onClick={stage === "done" ? () => onRefresh?.(providerId) : onStart}
          disabled={stage === "done" && !onRefresh}
          title={stage === "done" && !onRefresh ? t("card.authDonePreviewTitle") : undefined}
          aria-label={stage === "done" && !onRefresh ? t("card.authDonePreviewAria") : undefined}
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
          {errorKind === "cli_missing" ? (
            // t_12bdc277 P0 L1: CLI 缺失 — 专属引导, 不只是「重启试试」
            <div className="oneclick-auth-cli-missing" data-testid="oneclick-auth-cli-missing">
              <div className="oneclick-auth-cli-missing-title">
                {t("card.authCliMissingTitle", { cli })}
              </div>
              <div className="oneclick-auth-cli-missing-row">
                <code className="oneclick-auth-cli-missing-cmd" data-testid="oneclick-auth-cli-missing-cmd">
                  {t("card.authCliMissingInstall", { cmd: CLI_INSTALL_CMD[cli] ?? `npm i -g ${cli}` })}
                </code>
                <button
                  type="button"
                  className="btn btn-sm oneclick-auth-cli-missing-copy"
                  data-testid="oneclick-auth-cli-missing-copy"
                  onClick={() => {
                    void copyText(CLI_INSTALL_CMD[cli] ?? `npm i -g ${cli}`);
                  }}
                >
                  {t("card.copy")}
                </button>
              </div>
              <div className="oneclick-auth-cli-missing-note">{t("card.authCliMissingRestart")}</div>
              {pathHint ? (
                // t_12bdc277 P0 L2: npm prefix 不在 PATH 时, 附 PowerShell 修复命令
                <div className="oneclick-auth-path-hint" data-testid="oneclick-auth-path-hint">
                  <div className="oneclick-auth-path-hint-title">
                    {t("card.authCliMissingPathHintTitle", { prefix: pathHint.npmPrefix })}
                  </div>
                  <div className="oneclick-auth-path-hint-desc">
                    {t("card.authCliMissingPathHintDesc")}
                  </div>
                  <div className="oneclick-auth-path-hint-row">
                    <code className="oneclick-auth-path-hint-cmd" data-testid="oneclick-auth-path-hint-cmd">
                      {t("card.authCliMissingPathHintCmd", { prefix: pathHint.npmPrefix })}
                    </code>
                    <button
                      type="button"
                      className="btn btn-sm oneclick-auth-path-hint-copy"
                      data-testid="oneclick-auth-path-hint-copy"
                      onClick={() => {
                        void copyText(t("card.authCliMissingPathHintCmd", { prefix: pathHint.npmPrefix }));
                      }}
                    >
                      {t("card.copy")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <span>{errorMsg}</span>
          )}
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

/** 异常卡长文案(§2.1): 与 head 短徽章不同 —— head = statusBadge(单字原因, e.g. "采集失败"),
 * 长文案 = 详细原因(对用户讲明白怎么了) —— 例如 auth_expired 长文案 = "登录态过期, 请重新授权"。
 * 两者并存: head 一瞥可见红/黄状态, 卡内长文案给完整修复指引(为什么 + 怎么办)。
 * 关键: 长文案 ≠ 徽章文字, 不算"重复渲染"(t_5d8c3c81 修的是 error 卡"采集失败"两行字面重复,
 * 仍由 head 单独承担; 长文案保留 —— e2e 契约 + 完整错误原因)。
 */
const STATUS_DETAIL: Record<string, string> = {
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
 *
 * t_5d8c3c81 只读缓存语义(用户 9/9 拍板): 失败时保留旧数据(metrics 非空)。
 * 异常卡分两态:
 *   - 有旧数据(失败前采到过 ok 快照, metrics 非空)
 *     → 渲染正常卡形态(getTemplateFor 跑 BarsTemplate/TickerTemplate 等),
 *       头部已显状态徽章, 此处只补「数据时效标注」(失败时旧 fetched_at)+ 错误原因行
 *     → 用户看到: 进度条/余额 + 「采集失败」徽章 + 「数据来自 N 分钟前」 + 「为什么失败」
 *   - 无旧数据(首次就失败 / metrics 空)
 *     → 整卡文字(原状, 无假数据原则不变) + setup_hint 授权引导(若 auth_expired)
 *
 * 状态徽章(card-status-text)由 card-head 统一承担, 此处不再重复渲染。
 */
function AbnormalBody({ p, onRefresh }: { p: ProviderSnapshot; onRefresh?: (id: string) => void }) {
  const hasStaleData = p.metrics.length > 0;
  if (hasStaleData) {
    // 有旧数据的异常卡: 渲染正常模板 + 数据时效标注 + 错误原因。
    // 状态徽章已由 card-head 渲染(无重复)。
    // t_5d8c3c81 round-2: auth_expired 额外补 setup_hint/OneClickAuth — command 通道过期信号
    // 常见(bl/arkcli), 若该 provider 之前采到过 ok, 过期后看到旧进度条+黄徽章无任何重授权入口
    // 只能刷新=再次 auth_expired 死循环。补 setup_hint 行与 no-data 分支同构, 一键授权落地点保留。
    const Template = getTemplateFor(p).component;
    return (
      <div className="abnormal-body abnormal-body--stale-data" data-testid="abnormal-body">
        <Template p={p} />
        <div className="abnormal-body-stale-note" data-testid="stale-fetched-note">
          {t("card.staleFetchedAgo", { ago: agoText(p.fetched_at) })}
        </div>
        {p.status === "auth_expired" && p.setup_hint ? (
          <div className="setup-hint" data-testid="setup-hint">
            <span className="lamp" data-lamp="auth_expired" title={t("card.lampAuthTitle")} aria-label={t("card.lampAuthAria")}>
              ●
            </span>
            <span className="setup-hint-text">⚑ {p.setup_hint}</span>
            <HintCopyButton hint={p.setup_hint} />
            <OneClickAuth hint={p.setup_hint} providerId={p.provider_id} onRefresh={onRefresh} />
          </div>
        ) : null}
        {p.error_message ? (
          <div className="abnormal-body-error-reason text-error" data-testid="abnormal-error-reason">
            {p.error_message}
          </div>
        ) : null}
      </div>
    );
  }
  // 无旧数据(首次就失败 / 整卡 metrics 空): 整卡文字形态(§2.1 无假数据原则)
  // t_5d8c3c81 round-2: error 状态不再渲染 abnormal-status-detail 行 —
  // statusText.error 字面 == statusBadge.error("采集失败"), 渲染=字面重复(头徽章已呈)。
  // 错误原因已由下方 card-error-note 行(`... · error_message`)承载, 此行零信息增量。
  // stale / unsupported 同 statusText ≠ statusBadge(已陈旧/未接入), 仍保留 abnormal-status-detail 提供详细原因。
  // auth_expired 状态保留(statusText="登录态过期, 请重新授权" ≠ statusBadge="待授权", 二者语义互补)。
  const health = providerHealth(p);
  const showStatusDetail = p.status !== "error";
  return (
    <div className="abnormal-body abnormal-body--no-data" data-testid="abnormal-body">
        {showStatusDetail ? (
          <div className={`abnormal-status-detail text-${health}`} data-testid="abnormal-status-detail">
            {STATUS_DETAIL[p.status] ? t(STATUS_DETAIL[p.status] as Parameters<typeof t>[0]) : p.status}
          </div>
        ) : null}
        {p.status === "auth_expired" && p.setup_hint ? (
          <div className="setup-hint" data-testid="setup-hint">
            {/* lamp 单独在 setup_hint 行(引导感更强), task body 明示 auth_expired 的 lamp + setup_hint 授权引导保留 */}
            <span className="lamp" data-lamp="auth_expired" title={t("card.lampAuthTitle")} aria-label={t("card.lampAuthAria")}>
              ●
            </span>
            <span className="setup-hint-text">⚑ {p.setup_hint}</span>
            {/* t_66b67453 契约4: 一键复制授权命令(反引号内完整原文), 免手抄易错 */}
            <HintCopyButton hint={p.setup_hint} />
            {/* t_fb8c44d8: command 通道一键授权 — 自动开浏览器 + 粘贴 code 回喂, 消灭开终端 */}
            <OneClickAuth hint={p.setup_hint} providerId={p.provider_id} onRefresh={onRefresh} />
          </div>
        ) : null}
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
  onRefresh,
  dragHandle,
  dragging = false,
  dragDy = 0,
}: {
  p: ProviderSnapshot;
  /** 传入即渲染卡内删除钮(仅真实实例); 参数 = provider_id(= 实例 id) */
  onDelete?: (id: string) => void;
  /** t_034a6e81 Bug1 修: 已授权态点击 = 该卡刷线; 未传(mock 预览卡)时 done 态按钮禁用(不给可点但无效的按钮) */
  onRefresh?: (id: string) => void;
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
        {/* P1 形态(handle+name+StatusDot+状态徽章 三件套一行, 9/7 用户拍板, t_27eeadad):
         *   头部 BrandHandle = BrandLogo 拖把手(D-039) + display_name + StatusDot + statusBadge,
         *   删除钮沿用主页契约(D-038)不动。dragHandle 绑定到把手块保持 D-039 拖动排序契约。 */}
        <BrandHandle
          p={p}
          size={16}
          className={`brand-handle${dragHandle ? " drag-handle" : ""}`}
          testIdPrefix=""
          title={dragHandle ? t("card.dragSort", { name: p.display_name }) : p.provider_id}
          data-testid={dragHandle ? `drag-handle-${p.provider_id}` : undefined}
          {...dragHandle}
        />
        <span className="card-name" title={p.display_name}>
          {p.display_name}
        </span>
        <StatusDot health={health} size={8} />
        <span className={`card-status-text text-${health}`} data-testid="card-status-badge">{statusBadge(p)}</span>
        {onDelete && !confirming && (
          // t_433892c6 9/7 修订 H(老大 #1175 回归): 删钮 = 按钮自身 hover 热区,
          // 删 .card-del-zone 透明 div + :has() 让位规则 + z-index 博弈 三层机制。
          // 按钮 position:absolute 锚卡右上角, opacity:0 + pointer-events:auto
          // (opacity 不影响 hit-test, 按钮始终在 hit-test tree), :hover 触发 opacity:1。
          // 旧三层机制(c1d380f)结构死锁: zone 与 status badge 几何重叠 → zone 不 :hover
          // → button 永不显; 本方案直接按钮自为热区, 一行 CSS 闭环。
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
      {p.status === "ok" ? <Template p={p} /> : <AbnormalBody p={p} onRefresh={onRefresh} />}
      {/* 异常卡形态分两态由 AbnormalBody 内部决定(有旧数据 → 正常模板 + 时效标注; 无旧数据 → 整卡文字),
          此处不再做条件分支(t_5d8c3c81 只读缓存语义: 失败时保留旧 metrics)。 */}
    </section>
  );
}
