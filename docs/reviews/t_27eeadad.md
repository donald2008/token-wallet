# 人工审核意见 — t_27eeadad

reviewer: njbx02 (default, review lane run 808)
verdict: approved
date: 2026-09-07
review_target: 1d16697..7619552 (feat/theme-glass)

## 独立验证（本机 njbx02 干净 worktree @7619552 真实复跑）

- git 链: base 1d16697 / head 7619552 均在远端 feat/theme-glass ✓（分支头已被兄弟卡 t_5b092750 推进到 516c251，7619552 是其祖先 ✓）
- pnpm --filter @token-wallet/core build && pnpm typecheck → 0 错 ✓
  （注: 不先 build core 会报一批 TS2307 module resolution，属 monorepo 构建序，非交付缺陷）
- vitest → 336/336 通过（34 文件）✓
- pnpm test:e2e → 88/88 通过（含 quota-gallery / bar-tooltip / p1-screenshots）✓
- 截图人工目检: p1-home-dark.png + p1-home-glass.png 均为 P1 形态——头部一行(handle+名称+StatusDot+徽章)、正常卡三窗 micro 常驻直显、百炼 auth_expired 异常卡 AbnormalBody 完整、无 tooltip 残留、360x720 无撑爆/截断 ✓
- 验收 7 条全部对照通过（高度 720 落地于 electron/main.ts，minHeight 400 保留有注释论证）

## 修改项

无 BLOCKING。

1. [commit 7619552 / ProviderCardLayouts.tsx] WARNING — P5 组件越界进本卡 commit。
   卡体写「不动方案页 3 方案对比内容」，但 P5MonitorShortSide 组件 + PROVIDER_CARD_LAYOUTS 注册 + 头注释 3方案→4方案改写全部落在本卡 commit（base 1d16697 查实无 P5）。worker 披露称「P5 上一轮已合入」与事实不符——组件是本卡 commit 带进去的，只有 CSS/i18n 落在后续 t_5b092750 的 516c251。
   影响: t_5b092750 的证据链被拆到两张卡名下；本卡 diff 出现卡体外内容。功能无损（e2e/vitest 全绿），且 516c251 已在其上叠加，改写历史代价大于收益，故不要求回拆。
   教训: 兄弟会话同机并行时，越界文件应整文件让渡（留工作树给兄弟 commit），不是「只 add 自己改的文件」——同一文件被两会话改时此规则失效。
2. [commit 7619552 中间态] WARNING — 7619552 时点方案页 P5 是半成品: i18n key quota.cardP5Name/Desc 与 .qcard3-windows-row CSS 均不存在（516c251 才补），该 commit 检出时方案页 P5 渲染裸 key + 无样式。分支头已修复，仅记录「可检出性」债：跨卡拆功能时应保持每个 commit 自洽。
3. [registry.tsx L9-10] SUGGESTION — `// import { BarRowTooltip } ...` 注释掉的 import 行是死代码，应整行删除（上文注释已交代移除理由，留注释行无增量信息）。
4. [verification/p1-home-glass.png] SUGGESTION — glass 主题页背景为纯暗色，玻璃通透感仅表现为明暗差，backdrop-blur 效果未被验证到。非本卡范围，后续 glass 主题卡可考虑截图背景加渐变/光斑素材再回归。

## 结论

P1 主页接入（9/7 用户拍板）功能交付成立，验收 7 条全过，证据链完整可复现。APPROVE。
WARNING 1/2 的过程教训建议沉淀进派卡/worker 纪律（同机并行会话的文件级让渡规则）。
