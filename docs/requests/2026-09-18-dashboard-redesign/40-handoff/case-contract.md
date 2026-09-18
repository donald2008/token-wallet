# Case Contract — GATE 3 验收契约

## 北极星

GATE 3 真机验收**零返工一次通过**（Windows 真机，老大执行）。

## 验收清单（全过 = 通过）

1. **SC-10 三秒三问**：首屏 3s 内答出「这是什么 / 量级多大 / 健康吗」——演示者视角口述记录
2. **参考逐项比对**：S1-S14 对照 `references-locked.md` 参数逐项勾稽（对照表用 50-design/ 的比对记录 + 真机截图）
3. **三主题真机**：dark/light/glass 观感 + 对比度（程序化 lint 已前置，真机看玻璃质感与可读性）
4. **降级演练**：演示现场模拟 daemon 离线（停 daemon），大屏呈现专业降级形态（SC-02）
5. **回归**：主面板用量 tab / 托盘 / 设置页零回归（本周期 out of bounds）
6. **e2e 全绿**：迁移后 spec 全量绿（含 L2.5 900×640 三主题真壳截图）

## 证据留存

真机截图 + 验收记录 → `docs/verifications/`（既有惯例）+ 本目录 `60-design-qa/` 收口笔记；通过后合 master 打 tag（发版三件套流程见 RELEASE.md）。

## 未过处置

任何一项未过 → 回 test 分支修复循环（沿用 feat/dashboard-redesign），修复后仅重验未过项；两次不过 = 北极星失败，写 retro.md 复盘（管线修订机制）。
