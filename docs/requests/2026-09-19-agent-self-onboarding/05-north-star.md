# 05 · 北极星锁定（P0，2026-09-19）

继承 00-context-lock.md 全部常量。decision shape = solo（老大）。owner = 老大。

## 北极星候选表

| # | 候选 | 反代理测试 | 判定 |
|---|---|---|---|
| C1 | 非 Hermes agent 首次自适配成功率（发 URL 给陌生 agent，无需人工干预连上并出数） | 能：文档写得太简单（缺幂等/判重语义）→ agent 连上但上报脏数据，成功率虚高 → 对冲：验收场景含数据正确性核验 | **最强候选**，但「陌生 agent 样本」获取依赖老大手头 agent 群——GATE 3 以真实 agent 实测执行 |
| C2 | GATE 3 一次通过（含「拿 URL 给 agent 真连一次」场景） | 能：验收放水 → 对冲：验收场景锚定 spec 逐项（schema 完整性/示例可抄性程序化可验） | ✅ **选定**（延续上周期北极星模式：零返工 + 外部锚定） |
| C3 | /guide 文档完整度评分 | 能：堆字数凑分 | 否，降为 P3 spec 的 checklist 项 |

## 北极星

**GATE 3 一次通过，含核心验收场景「把引导 URL + key 交给一个非 Hermes agent，其 LLM 依据文档自助完成接入并成功上报」**——专业度判定锚定 spec 完整性 checklist（程序化可验部分）+ 真机实测（人肉部分）。

## 领先指标

```
北极星：陌生 agent 自适配成功（GATE 3 场景）
  ← L1：/guide 文档 spec 完整性 checklist 全绿（schema 全文/真实 payload/幂等语义/验证步骤）
  ← L2：GATE 2 设计门禁一次过
  ← 输入层：AgentUsageReport v1 与 docs/mcp-protocol.md 零漂移（文档抄 spec，不重写）
```

优先级流向：一切决策向「陌生 agent 的 LLM 拿到 URL 能自助走通」收敛；**因此降级的**——人类可读性美化（人也是读者但 LLM 优先）、per-agent 定制内容、英文版、引导页视觉大改（沿用现有面板风格，克制）。

## 待确认（GATE 1 一并裁）

- Q1 陌生 agent 样本：GATE 3 用哪个 agent 实测？（建议：老二机 home-computer 的 opencode 或 claude-code，真实非 Hermes 环境）
- Q2 /guide 旧 HTML 表格视图：升级为新文档页还是保留双视图（JSON 机读 + HTML 人读）？（倾向：HTML 视图直接变文档页，JSON 保留给程序化消费）
