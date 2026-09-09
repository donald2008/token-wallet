# 人工审核意见 — t_f7d1beeb

reviewer: njbx02（老大，human 终审阶段；auto 阶段 desktop-e5jupfs-reviewer round 2 已 APPROVE）
verdict: approved
head: 5487720 (feat/theme-glass, 本地=远端一致，git ls-remote 实测)
date: 2026-09-07

## 审核范围

卡体 A（micro 用量行只显百分比）+ 修订 C/D/E/F + 对比素材（BLOCKING #1-#5，
round 1 reviewer comment #1152 驳回项）。

## 独立验证（njbx02 干净 worktree /tmp/tw-human-r2 @ 5487720）

- typecheck: core + app 0 错（先 core build，monorepo 构建序）
- vitest: core 161/161 + app 34 files/341 tests 全绿
- e2e: 88/88 passed（44.7s，含改写后的 filter-chips 6 用例 + scrollbar 去 iconsRight）
- vite build: 0 错
- 冷读 diff：234ac12（QuotaMeter micro 分支 target+'%'，usageText 本体零改，
  P5 临时换行 CSS 删除）+ 5487720（C: .titlebar height var(--space-32)=32px；
  D: add-btn 去 span 文字 + icon-only class + aria-label/title 兜底；
  E: {false && <FilterIcons/>}，state 管线保留；F: .card-del-btn absolute
  锚右上（父 .card 已有 position:relative，D-038 锚点复用）+ .card-status-text
  margin-left:auto）——与修订契约逐项对上，无 scope 漂移。
- 视觉复核：入库 p1-home-{dark,light,glass}.png 三张 vision 五项全过
  （标题栏紧凑单行、status 贴卡右上、用量行纯百分比、底栏 add=纯+图标、零重叠裁切）。
- 对比素材：worker scratch 9 张未入库（按兄弟惯例）；老大侧另行重现
  「P1 主页卡 vs 修复后 P5 卡」三主题并排图（workspace p1-vs-p5/），
  P5 三 micro 窗 = 80%/20%/30% 纯百分比、双列零撞字、Reset 右对齐，
  与 P1 卡头规范一致 —— 用户 A/B 对比诉求已满足。

## WARNING（放行但记录）

1. micro 短格式 Math.round 取整（38%）与 usageText percent 单位 fmt1（37.9%）
   风格不一致 —— task body 明示按 Math.round 走，本卡合规；是否全局统一
   待老大/用户拍板，勿在后续卡里默默改。
2. e2e filter-chips 改写为「隐藏契约」后，FilterIcons 可见态的 e2e 覆盖消失
   （FilterChips.test.tsx L1 组件测试仍在）。恢复筛选按钮时需同步翻回 e2e。

## SUGGESTION

1. App.tsx L384 的 `{false && ...}` 恢复开关建议后续换成 settings 开关或
   feature flag（当前形态是用户「先隐藏」语义的最简忠实实现，可接受）。
2. p1-home-light.png 首卡为 auth_expired 卡（无 micro 用量行样本）——
   OK 卡 micro 短格式已由 P5 对比图实证，不阻断；后续截图脚本可指定 OK 场景。
