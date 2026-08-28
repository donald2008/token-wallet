import type { ProviderSnapshot } from "../types";
import { HEALTH_LABEL, providerHealth } from "../health";
import { getTemplateFor } from "../templates/registry";

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
  unsupported: "暂不支持, 欢迎 PR",
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
          ⚑ {p.setup_hint}
        </div>
      )}
      <div className="card-error-note">
        上次更新: {agoText(p.fetched_at)}
        {p.alerts.length > 0 ? ` — ${p.alerts.map((a) => a.message).join("; ")}` : ""}
      </div>
    </div>
  );
}

export function ProviderCard({ p }: { p: ProviderSnapshot }) {
  const health = providerHealth(p);
  const Template = getTemplateFor(p).component;
  return (
    <section className="card" data-testid="provider-card" data-provider={p.provider_id} data-health={health}>
      <div className="card-head">
        <span
          className="brand-block"
          style={{ background: BRAND_COLORS[p.provider_id] ?? "var(--unknown)" }}
        />
        <span className="card-name" title={p.provider_id}>
          {p.display_name}
        </span>
        <span className={`card-status-text text-${health}`}>{HEALTH_LABEL[health]}</span>
      </div>
      {p.status === "ok" ? <Template p={p} /> : <AbnormalBody p={p} />}
    </section>
  );
}