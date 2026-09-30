# onboarding 周期 retro（t_ab9fde73 收口，2026-09-23）

## 产生了价值

- **guide「文档即产品」路线成立**：SCHEMA/ENVELOPE/EXAMPLE 从协议档程序化提取 + `test_doc_consistency.py` 篡改即红，整个周期零文档漂移；SC-02 北极星实测（陌生 opencode 凭 URL+key 自助接入 → report_usage 落库 → usage_summary 可见）把产品核心声明变成了服务端铁证。
- **门禁移交纪律**：OB-03 人工终审把两项圈外尾巴（README 改写时序、OB-06 独立卡）精确移交本卡，避免 GATE 基线漂移；验证报告版本化（v1/v2 delta）让 4 天跨度的验收可接续。
- **阻塞转修复卡 + 反向依赖**：opencode Bus error 当场立修复卡 t_1d94e3a1 并接反向依赖，B 节解锁后零重接管成本。

## 卡壳与教训

- **外部 harness 依赖必须 R-3 预检**：opencode 二进制 Bus error（exit 135）+ 默认 free provider 被服务端封禁/限流，两次都在动手后才暴露——凡场景依赖第三方工具/模型，先探针后开跑。
- **被测对象与驱动 LLM 分离**：B 节首跑 rate limit 卡死在 step=0（连 guide 都没读）；判定「非链路问题」的依据是区分被测语义（自助接入）与驱动它的 LLM 牌子，换可模型重跑即过。
- **「合并+tag ≠ 收口完成」**：C 段操作面完成后 blast-radius §4 回写清单仍缺 2 项（DECISIONS D-060(原 D-058)、mcp-protocol /guide 节）——回写清单是收口卡的合同，须逐项勾稽而非以合并动作为完成信号（本卡补齐即实证）。
- **遗留观察**：`/guide/`（尾斜杠）未豁免鉴权 → 401；面板展示/复制 URL 无尾斜杠，触发面仅手输，非阻塞留档。

## 仪式嫌疑

- 无明显空转环节；各阶段产物（context-lock/spec/blast-radius/验证报告）均被下游真实消费。
