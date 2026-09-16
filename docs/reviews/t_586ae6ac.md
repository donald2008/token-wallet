# 人工终审意见 — t_586ae6ac

reviewer: njbx02（老大）
verdict: approved
commit: 06dee5e（base 65f9d6c，分支 docs/mcp-protocol）
date: 2026-09-06

## 独立验证（非采信 worker/reviewer 声明）

- git 证据链：远端 docs/mcp-protocol == 06dee5e == 本地 checkout；base/head 均真实；`git diff --stat` 仅 3 个 md（docs/mcp-protocol.md +674 / docs/DECISIONS.md +1 / packages/mcp-server/README.md ±25），零代码改动属实
- 13 个 json block 全部可解析（13/13）
- fingerprint 按 §3 canonical 规则独立重算：F1 == F4b（二级判重命中）、F1 != F2，与 spec 期望一致；F3（unknown）tokens 取 0 规则实测
- uuidv7 pattern 对 F1-F5 全部合法 id 匹配、`not-a-uuid` 正确拒绝
- D-048 编号：全分支最大 D-047 → D-048 无冲突；与 D-008（不维护第二套 HTTP API）为延续关系，与 D-020/D-034 的 node:sqlite 范围覆盖声明方向正确
- §4.2 与 core 现表 `usage_records`（schema-sql.ts）字段核对：window_start/end epoch 秒、cost_cny 列名错位登记属实

## 契约审计（卡 body 定稿 §1-§7 vs spec）

逐条对齐，无设计偏离：schema 四分项/total 无 tokens/status 三态语义/批量信封 1-100/三工具 input+output 全字段/计数不变量/部分失败不回滚/整批重发 rejected 不重发/day=daemon 本地时区+timezone 字段/generated_at/混币种分行不换汇/unknown 不计 tokens/两级判重+INSERT OR IGNORE/误杀声明/DDL 权威全文/TTL USAGE_TTL_DAYS 缺省 90 先聚合后删/Bearer+Consul 路径+不豁免 loopback/:9131+systemd+Consul 注册/本地模式例外/hook 行为约定（post_llm_call、on_stream_end、buffer 50∨60s∨会话结束、断线排队、零阻塞）/5 组 fixture（正常/partial/unknown/重复/坏 schema + F4b 变体）。

worker 对「信封 maxItems」的澄清（schema 约束非传输字段，L138 警示）是对定稿素材的正确精确化，非改设计。

## 对 auto 审查 5 项 P2 的裁决

1. **P2 #1（范围覆盖声明未引 D-020）** — 留档，下次文档修订顺带补引。D-048 声明语义已覆盖（「mcp-server 走 node:sqlite」句仅对 app 侧有效），不构成矛盾。
2. **P2 #2（status↔usage 交叉约束未进 schema、无负例 fixture）** — **裁决：转下游实现卡硬性要求**，本卡不追加 commit。pydantic（daemon 卡 t_f9ed9235）与 zod（hook 卡 t_0ea1d8b6）必须实现交叉校验：`status ∈ {completed, partial}` 且 `usage: null` → reject。两卡 body/comment 已同步此要求。规则本身在 §1.1 null 分支 description + §1.2 已成文，文档权威源无歧义；schema 层 if/then 补强与 F6 负例 fixture 归 daemon 卡落地时一并回写 spec（文档修订随实现卡走，避免 docs 卡二次往返）。
3. **P2 #3（F5 隐含每组 fixture 独立库前提）** — 接受现状。F5 期望已在文中写明第 3 条照常落库，测试实现时按独立库跑即可，daemon 卡测试注意。
4. **P2 #4（日聚合异币种 cost）** — 接受现状。§4.2 已定「聚合行 cost_cny 存 USD、币种权威视图=usage_summary」，边界闭合。
5. **P2 #5（D-048 术语「event_id PRIMARY KEY」vs DDL id INTEGER PK + event_id UNIQUE）** — 功能等价，接受。DDL 权威=spec §4.1，以 DDL 为准。

## 结论

APPROVE。docs-only 卡验收 5 项全过；5 项 P2 无一阻塞，#2 转下游实现卡硬性要求（已同步两子卡）。complete 本卡释放 t_f9ed9235（daemon）/ t_0ea1d8b6（hook）。
