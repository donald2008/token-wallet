# 大屏重设计管线复盘（retro，2026-09-19）

周期：2026-09-18 dashboard-redesign（SL-01~09 + GATE 1~3）· 收口卡 t_a96a36b0
发版：v0.2.9（merge f05f560 → tag v0.2.9 双推 → build:win → 8889 + gitee stable 双渠道匿名实测通过）

## 一、管线全景

| 卡 | 内容 | 结果 | 修复轮 |
|---|---|---|---|
| 前置 | 上下文锁定→北极星→调研→策略（GATE 1 分项裁定：推倒重来） | 15-gate1-record.md | — |
| 设计 | 三 IA 立场 mock + design-qa 两轮收敛（R1×3+R2×2 修复） | 60-design-qa/report.md 三层全过 | 预门禁迭代，非返工口径 |
| GATE 2 | 老大亲手翻 approved（Ops Wall 胜出 + 精确数保留） | 40-handoff/design-gate.json | — |
| SL-01 t_15397c99 | IA 骨架重构 Ops Wall 12 列落地 | APPROVE | round-2（P1×1+P2×2，920b0d1） |
| SL-02 t_a8eef71c | S1-S14 收尾 + 成本列 | 一次通过 | 0 |
| SL-03 t_27c97750 | 无 daemon 专业降级形态 | 一次通过 | 0 |
| SL-04 t_36b7ecb1 | i18n 双语收口 | APPROVE | round-2（P1-1+P2-1+P2-2） |
| SL-05 t_f4bb9354 | e2e 契约迁移收口（35 项逐条打点+突变验判别力） | APPROVE | 0（W4=既有红销项） |
| SL-07 t_fe5efb40 | 文档收口 | changes_requested → SL-07-fix t_9fdd07b5 | 1 |
| SL-06 t_3bed11f6 | GATE 3 真机验收（老大 Windows） | 拦下 2 瑕疵 | → SL-08 |
| SL-08 t_6cb7699c | 瑕疵修复（Model 表截断+明细撑高+顶栏删减） | 人工终审 Round 2 APPROVE | 1 |
| SL-09 t_a96a36b0 | 发版收口（本卡） | v0.2.9 全链落地 | — |

## 二、北极星「零返工一次通过」实绩记录

**字面未达成，趋势达意**：6 张执行卡中 3 张一次通过（SL-02/03/05），4 张各耗 1 轮修复
（SL-01、04 审查 round-2；SL-07 终审退回；SL-06 真机→SL-08）。

- 返工集中早期卡，随契约成熟递减——SL-05 起连续两张零修复轮，testid 契约先行（27 项对照代码真值逐条处置）是最大功臣。
- **门禁拦截率 100%**：全部缺陷在 GATE 3 / 人工终审被拦下，无一漏到最终用户。
- design-qa 三层验收（工序→工艺→反默认）把视觉瑕疵消灭在 GATE 2 之前——两轮修复属预门禁迭代，符合设计。
- 独立复审纪律实锤生效：干净 worktree 复跑对照、PW_PORT 隔离端口防假绿/假红、e2e 截图跑后 `git checkout -- .` 复原。

## 三、repair subagent 误收口事件与防线

本周期三度实锤（t_a8eef71c / t_fe5efb40 / t_3bed11f6）：skill 加载失败 auto-triage 派 repair
subagent，其对人工门禁卡误 complete（不查交付物、自报「已修复」）。防线卡 t_68e3c064 落地
三层防护（c86d6ce，已 push）：

1. 插件层 env scrub + 双标记（human-gate 标记不可被 worker 侧伪造）；
2. runtime 工具层 `_repair_complete_gate`：human-gate 卡拒绝 complete + complete 前强制
   evidence comment 门禁（complete/block/request_review 三入口全覆盖）；
3. prompt 层看板隔离纪律（repair 子代理不看卡、只修环境）。

教训通式：**自动分诊派生的 subagent 权限必须小于原 worker**，且其完成动作不得直接翻转
人工门禁状态。

## 四、管线沉淀（可复用资产）

- 六件套交接包（plan/data-model/slices/testid 契约/case-contract/design-gate）——规格→工程
  交接零口头损耗，后续设计周期沿用。
- GATE 结构：GATE 1 裁定分项显式记录（15-gate1-record.md「修订必须显式记录，不静默吸收」）；
  GATE 2 approved 只能老大亲手翻（「代码里没有写 true 的路径」）；GATE 3 真机双层裁决
  （真机实测 + 人工终审透镜，不采信 worker 自审）。
- 落选 IA 归档可查（50-design/ 保留 Terminal Ink / Console），杂交项显式记录（Console 离线
  面板 → S14 降级形态已实现）。
- 决策落册：DECISIONS D-054（撞号保号）/ D-055 / D-056 Ops Wall 定案 / D-057（feat 侧改号），
  merge 后 `uniq -d` 查重 0 命中。

## 五、收口执行中的坑（本轮实证）

- **长卡 iteration 预算会被执行细节吃光**：SL-09 首轮 run 迭代耗尽 timed_out，但工作实际
  已完成约 80%（merge/tag/build/双渠道上传均落盘）。教训：收口类卡在关键里程碑后立即
  comment 落板（merge done / tag done / build done），重启 run 按 git+磁盘状态接力恢复，
  不从头重跑——本轮正是按「恢复纪律」先抢救在途成果再补尾。
- **发版纪律照旧全中**：gitee release 页（第 6 步）历来漏执行坑再次应验——tag 推了 release
  页为空，本轮补建 v0.2.9 release + 附件；「API 成功≠下载路径已更新」——双渠道全部匿名
  curl 实测（latest.yml 版本号 / exe Content-Length / 整包 sha256 比对构建产物一致）。
- SHA256SUMS.txt 与 .sha256 sidecar 停在 v0.2.0 时代，本轮刷新至 v0.2.9 并入树。
- 遗留记档（无真实压力不修）：SL-08 顶栏删减后 `app-dash.css` 残留 3 处
  `.dash-titlebar-controls` 死规则（DOM 零引用，纯冗余）。

## 六、遗留与去向

- **自更新链路真机确认（Windows 人肉验收）**：旧版（v0.2.8-）设置页「关于」→「检查更新」
  一键升到 v0.2.9。包内 app-update.yml 已核 = gitee stable 通道，服务端 latest.yml=0.2.9
  匿名可达，待老大真机点一下确认闭环。
- 稳定基线已恢复：master = v0.2.9，feat/dashboard-redesign 长活分支使命完成（已并入，
  后续 UI 迭代开新分支）。
