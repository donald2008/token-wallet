import { useState } from "react";
import type { ProviderSnapshot } from "../types";
import { providerHealth, statusBadge } from "../health";
import { getTemplateFor } from "../templates/registry";
import type { DragHandleProps } from "../useCardDragSort";

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
      title={`复制命令: ${command}`}
      aria-label={copied ? "已复制" : `复制命令 ${command}`}
      onClick={onCopy}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** 品牌色块(§6.1 第 4 条): 16px 平台识别色, 正式版替换为内置单色 SVG 品牌图标 */
const BRAND_COLORS: Record<string, string> = {
  deepseek: "#4d6bfe",
  "kimi-code": "#7c3aed",
  aliyun: "#ff6a00",
  ark: "#1668dc",
  "opencode-go": "#0ea5e9",
};

const STATUS_TEXT: Record<string, string> = {
  stale: "数据过期(超 2 个轮询周期未更新)",
  auth_expired: "登录态过期, 请重新授权",
  unsupported: "该通道暂未接入",
  error: "采集失败",
};

function agoText(fetchedAt: number): string {
  const s = Math.floor(Date.now() / 1000) - fetchedAt;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${Math.floor(s / 3600)} 小时前`;
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
          <span className="lamp" data-lamp="auth_expired" title="登录态失效, 亮黄灯" aria-label="auth_expired 黄灯">
            ●
          </span>
        )}
        {STATUS_TEXT[p.status] ?? p.status}
      </div>
      {p.status === "auth_expired" && p.setup_hint && (
        <div className="setup-hint" data-testid="setup-hint">
          <span className="setup-hint-text">⚑ {p.setup_hint}</span>
          {/* t_66b67453 契约4: 一键复制授权命令(反引号内完整原文), 免手抄易错 */}
          <HintCopyButton hint={p.setup_hint} />
        </div>
      )}
      <div className="card-error-note">
        上次更新: {agoText(p.fetched_at)}
        {p.alerts.length > 0 ? ` — ${p.alerts.map((a) => a.message).join("; ")}` : ""}
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
          style={{ background: BRAND_COLORS[p.provider_id] ?? "var(--unknown)" }}
          title={dragHandle ? `拖动排序 ${p.display_name}` : p.provider_id}
          data-testid={dragHandle ? `drag-handle-${p.provider_id}` : undefined}
          {...dragHandle}
        />
        <span className="card-name" title={p.provider_id}>
          {p.display_name}
        </span>
        <span className={`card-status-text text-${health}`}>{statusBadge(p)}</span>
        {onDelete && !confirming && (
          <button
            type="button"
            className="btn btn-icon btn-danger card-del-btn"
            data-testid={`card-del-${p.provider_id}`}
            title={`删除 ${p.display_name}`}
            aria-label={`删除 ${p.display_name}`}
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
            <span className="confirm-text">删除并清钥匙串?</span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              data-testid={`card-confirm-del-${p.provider_id}`}
              onClick={() => {
                setConfirming(false);
                onDelete(p.provider_id);
              }}
            >
              确认
            </button>
            <button
              type="button"
              className="btn btn-sm"
              data-testid={`card-cancel-del-${p.provider_id}`}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          </span>
        )}
      </div>
      {p.status === "ok" ? <Template p={p} /> : <AbnormalBody p={p} />}
    </section>
  );
}
