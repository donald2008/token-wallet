import { useState } from "react";

/**
 * 本地 Agent 区(§6.5): 默认折叠占位, P3 才做真实数据(per-agent 用量 + 云×本地对比行)。
 * 目前仅有占位文案 + 可折叠交互骨架。
 */
export function LocalAgentSection() {
  const [open, setOpen] = useState(false);
  return (
    <section className="local-agent" data-testid="local-agent-section">
      <button
        type="button"
        className="local-agent-head"
        data-testid="local-agent-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="local-agent-chevron" data-open={open || undefined}>
          ▸
        </span>
        <span className="local-agent-title">本地 Agent</span>
        <span className="local-agent-tag">P3 占位</span>
      </button>
      {open && (
        <div className="local-agent-body" data-testid="local-agent-body">
          <div className="ticker-sub">per-agent 用量 + 云×本地对比行(P3 接入真实数据)</div>
        </div>
      )}
    </section>
  );
}