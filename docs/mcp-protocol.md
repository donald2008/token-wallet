# token-wallet MCP 协议规范（v1）

| | |
|---|---|
| 状态 | **权威源**（本文档即协议，实现卡照此落地） |
| 版本 | v1（`schema_version: 1`） |
| 日期 | 2026-09-06 |
| 决策记录 | D-048（docs/DECISIONS.md） |
| 上游分支 | `feat/theme-glass`，本文在 `docs/mcp-protocol` 分支 |
| 下游实现卡 | daemon 实现卡（Python fastmcp）/ hook 插件卡（TS zod）/ App 展示卡（后置） |
| 覆盖关系 | 本文 supersede DESIGN.md §8 中「计划工具(P3): quota_status / quota_history / agent_usage」的早期工具面清单；quota 两工具转为二期（§2.4） |

---

## 0. 定位与边界

token-wallet MCP Server 是**唯一数据访问面**：

- agent hook 上报 LLM 消耗 → `report_usage`（MCP 写工具）
- app 展示聚合 → `usage_summary` / `usage_report_echo`（MCP 读工具）
- agent 自查消耗 → 同上两个读工具

**SQLite 是 daemon 私有实现细节**。除 daemon 进程外，任何组件（hook / app / agent）一律走 MCP 工具，**禁止直查数据库文件**。唯一例外见 §6（本地模式）。

> 范围覆盖声明：D-034 曾记录「mcp-server 走 node:sqlite」——该句是当时代码栈（全 TS）下的同构假设。daemon 选型定 Python fastmcp 后，daemon 侧 SQLite 用 Python `sqlite3` 实现，**表结构与协议语义以本文档为权威**；D-034 对 app 主进程侧的结论不变。

三件归属：

| 组件 | 负责 | 实现方 |
|---|---|---|
| MCP daemon（:9131） | 存储/判重/聚合/TTL/计价补算 | 老二（home-computer） |
| hook 插件 | 在 agent harness 内提取用量并上报 | 老大 |
| App 展示 | 远程模式读 MCP 出图 | 老三（后置） |

---

## 1. AgentUsageReport v1

### 1.1 JSON Schema（权威，draft 2020-12）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AgentUsageReport",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "event_id", "status", "agent_id", "harness",
               "ts", "model", "provider", "usage", "context"],
  "properties": {
    "schema_version": { "const": 1 },
    "event_id": {
      "type": "string",
      "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      "description": "uuidv7，hook 在事件点生成；重试/重发必须复用同一 event_id"
    },
    "status": { "enum": ["completed", "partial", "unknown"] },
    "agent_id": { "type": "string", "minLength": 1,
      "description": "njbx02 | home-computer | desktop-e5jupfs | ..." },
    "harness": { "enum": ["hermes", "claude-code", "opencode", "codex", "other"] },
    "session_id": { "type": ["string", "null"] },
    "ts": { "type": "string", "format": "date-time",
      "description": "ISO8601，事件发生时刻（非上报时刻）" },
    "model": { "type": "string",
      "description": "模型名；status=unknown 拿不到时允许空字符串" },
    "provider": { "type": "string",
      "description": "provider 名；status=unknown 拿不到时允许空字符串" },
    "usage": {
      "oneOf": [
        { "$ref": "#/$defs/usage_body" },
        { "type": "null", "description": "仅 status=unknown 允许：占位记录" }
      ]
    },
    "context": {
      "type": "object",
      "additionalProperties": false,
      "required": ["kind"],
      "properties": {
        "kanban_task": { "type": ["string", "null"],
          "description": "t_xxxxxxxx；非 kanban 场景 null" },
        "kind": { "enum": ["coding", "review", "chat", "cron", "other"] }
      }
    }
  },
  "$defs": {
    "token_cost": {
      "type": "object",
      "additionalProperties": false,
      "required": ["tokens"],
      "properties": {
        "tokens": { "type": "integer", "minimum": 0 },
        "cost": { "type": ["number", "null"], "minimum": 0 },
        "currency": { "type": ["string", "null"] }
      }
    },
    "cost_only": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cost": { "type": ["number", "null"], "minimum": 0 },
        "currency": { "type": ["string", "null"] }
      }
    },
    "usage_body": {
      "type": "object",
      "additionalProperties": false,
      "required": ["input_cache_hit", "input_cache_miss", "output", "total"],
      "properties": {
        "input_cache_hit":  { "$ref": "#/$defs/token_cost" },
        "input_cache_miss": { "$ref": "#/$defs/token_cost" },
        "output":           { "$ref": "#/$defs/token_cost" },
        "total":            { "$ref": "#/$defs/cost_only" }
      }
    }
  }
}
```

批量信封（`report_usage` 的 input）：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ReportUsageInput",
  "type": "object",
  "additionalProperties": false,
  "required": ["reports"],
  "properties": {
    "reports": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": { "$ref": ".../AgentUsageReport" }
    }
  }
}
```

> ⚠️ `maxItems: 100` 是 schema 约束，**不是信封传输字段**。信封里只有 `reports` 一个字段，出现 `maxItems` 键会被 `additionalProperties: false` 拒绝。

### 1.2 字段语义（定稿，勿再议）

- **四分项统一小 schema**：`input_cache_hit` / `input_cache_miss` / `output` 均为 `{tokens, cost, currency}`；`total` 只有 `{cost, currency}`（求和结果，无 tokens）。
- **cost / currency 可 null**：agent 只保证 **tokens 忠实**。计价责任在 **daemon 侧价目表**（同模型全集群一口价）：agent 报了 cost 就用 agent 的；为 null 则 daemon 按价目表补算。
- **status 语义**：
  - `completed` — 调用正常结束，usage 完整；
  - `partial` — 流式被 cancel，**报已收到的部分 usage**（钱花了要记，残缺要标记）；
  - `unknown` — 取消后拿不到 usage，`usage: null` 占位记录；**不计入 token 聚合**，只进 `calls` / `by_status` 与对账视图。
- **event_id**：uuidv7。hook 在**事件点**生成，重试/重发/重放**不变**（幂等锚点，见 §3 一级判重）。
- **ts**：事件发生时刻（ISO8601，带时区偏移）；聚合窗口按此字段过滤，不按入库时间。
- **session_id / context.kanban_task** 可空；`context.kind` 必填（无法归类时 `other`）。

---

## 2. MCP 工具面（v1 全部 = 3 个）

传输：MCP streamable-http，端点 `http://<host>:9131/mcp`，Bearer 鉴权（§5）。

### 2.1 `report_usage`（写）

**input**：§1.1 批量信封（1–100 条）。

**output JSON Schema**：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ReportUsageOutput",
  "type": "object",
  "additionalProperties": false,
  "required": ["accepted", "duplicated", "rejected"],
  "properties": {
    "accepted":   { "type": "integer", "minimum": 0 },
    "duplicated": { "type": "integer", "minimum": 0 },
    "rejected": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["index", "event_id", "error"],
        "properties": {
          "index":    { "type": "integer", "minimum": 0,
                        "description": "在 reports 数组中的下标" },
          "event_id": { "type": ["string", "null"],
                        "description": "提取不到 event_id 时为 null" },
          "error":    { "type": "string", "minLength": 1,
                        "description": "逐条校验失败明细" }
        }
      }
    }
  }
}
```

**语义约定（hook 依赖）**：

1. 不变量：`accepted + duplicated + rejected.length == reports.length`；
2. `duplicated` **不是错误**——幂等重发安全（§3）；
3. `rejected` 只含**逐条 schema 校验失败**，带 `index + event_id + error` 逐条明细；
4. **部分失败不回滚**——同批内合法条目照常落库；
5. 信封级校验失败（reports 非数组 / 空数组 / 超 100 条 / 顶层多字段）→ 整个调用返回 tool error，不做部分应用；
6. **hook 重试策略**：网络失败 → **整批原样重发**（event_id 幂等保证）；`rejected` 条目**不重发**（重发仍会被拒）。

### 2.2 `usage_summary`（读聚合）

**input JSON Schema**：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "UsageSummaryInput",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "since":  { "type": "string", "format": "date-time",
                "description": "缺省 = 今天 00:00（daemon 本地时区）" },
    "until":  { "type": "string", "format": "date-time",
                "description": "缺省 = 当前时刻" },
    "agent_id":     { "type": "string" },
    "provider":     { "type": "string" },
    "model":        { "type": "string" },
    "kanban_task":  { "type": "string" },
    "group_by": {
      "type": "array", "minItems": 1, "maxItems": 3, "uniqueItems": true,
      "items": { "enum": ["agent", "provider", "model", "day", "status"] },
      "description": "缺省 [\"agent\"]"
    }
  }
}
```

**output JSON Schema**：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "UsageSummaryOutput",
  "type": "object",
  "additionalProperties": false,
  "required": ["window", "timezone", "generated_at", "rows", "total"],
  "properties": {
    "window": {
      "type": "object", "additionalProperties": false,
      "required": ["since", "until"],
      "properties": {
        "since": { "type": "string", "format": "date-time" },
        "until": { "type": "string", "format": "date-time" }
      }
    },
    "timezone":    { "type": "string", "description": "IANA 名，如 Asia/Shanghai" },
    "generated_at":{ "type": "string", "format": "date-time",
                     "description": "App 据此判断新鲜度" },
    "rows": { "type": "array", "items": { "$ref": "#/$defs/summary_row" } },
    "total": { "$ref": "#/$defs/summary_total" }
  },
  "$defs": {
    "by_status": {
      "type": "object", "additionalProperties": false,
      "required": ["completed", "partial", "unknown"],
      "properties": {
        "completed": { "type": "integer", "minimum": 0 },
        "partial":   { "type": "integer", "minimum": 0 },
        "unknown":   { "type": "integer", "minimum": 0 }
      }
    },
    "summary_row": {
      "type": "object", "additionalProperties": false,
      "required": ["group", "calls", "input_cache_hit_tokens",
                   "input_cache_miss_tokens", "output_tokens",
                   "cost_total", "currency", "by_status"],
      "properties": {
        "group": { "type": "string",
          "description": "多维度时按 group_by 顺序用 | 连接，如 njbx02|glm-5.3-flash；day 维度 = YYYY-MM-DD（daemon 本地时区）" },
        "calls": { "type": "integer", "minimum": 0 },
        "input_cache_hit_tokens":  { "type": "integer", "minimum": 0 },
        "input_cache_miss_tokens": { "type": "integer", "minimum": 0 },
        "output_tokens":           { "type": "integer", "minimum": 0 },
        "cost_total": { "type": ["number", "null"] },
        "currency":   { "type": ["string", "null"] },
        "by_status":  { "$ref": "#/$defs/by_status" }
      }
    },
    "summary_total": {
      "type": "object", "additionalProperties": false,
      "required": ["calls", "input_cache_hit_tokens", "input_cache_miss_tokens",
                   "output_tokens", "cost_total", "currency", "by_status"],
      "properties": {
        "calls": { "type": "integer", "minimum": 0 },
        "input_cache_hit_tokens":  { "type": "integer", "minimum": 0 },
        "input_cache_miss_tokens": { "type": "integer", "minimum": 0 },
        "output_tokens":           { "type": "integer", "minimum": 0 },
        "cost_total": { "type": ["number", "null"],
          "description": "窗口内出现 >1 种币种时为 null（不做汇率换算）" },
        "currency":   { "type": ["string", "null"],
          "description": "单一币种时为该币种；混币种 null" },
        "by_status":  { "$ref": "#/$defs/by_status" }
      }
    }
  }
}
```

**语义**：

- 时区：`day` 分组与 `since` 缺省一律 **daemon 本地时区**（njbx02 = CST, Asia/Shanghai）；响应带 `timezone` 字段，**App 不自行换算**；
- `generated_at` 供 App 判断新鲜度；
- **混币种按币种分行**（同一 agent 同窗口 USD 一行、CNY 一行），不做汇率换算；`total.cost_total` 在混币种时为 null；
- **`unknown` 不计 tokens**，只进 `calls` 与 `by_status`；`partial` 正常计 tokens（报的就是已收部分）。

### 2.3 `usage_report_echo`（读原文）

**input JSON Schema**：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "UsageReportEchoInput",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "event_id":   { "type": "string", "description": "精确查一条" },
    "session_id": { "type": "string", "description": "按会话查" },
    "since": { "type": "string", "format": "date-time" },
    "until": { "type": "string", "format": "date-time" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 500,
               "description": "缺省 50" }
  },
  "description": "event_id 与 session_id 互斥，至多出现一个；全空 = 按 since/until 时间段查"
}
```

**output JSON Schema**：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "UsageReportEchoOutput",
  "type": "object",
  "additionalProperties": false,
  "required": ["events", "total_count"],
  "properties": {
    "events": {
      "type": "array",
      "items": { "type": "object",
        "description": "落库原文 = hook 提交的 AgentUsageReport 原样 JSON（raw_json），另附 daemon 补齐的 cost/computed 字段" }
    },
    "total_count": { "type": "integer", "minimum": 0,
      "description": "过滤条件命中总数（不受 limit 影响）" }
  }
}
```

用途：验收自证（上报后 echo 回读核对）+ 对账排查原始视图。

### 2.4 二期预览（不在 v1 实现面）

`quota_status` / `quota_history`（provider 套餐快照与历史，原 P3 三工具中的两个）顺延为二期；v1 工具面**只有** §2.1–§2.3 三个工具。

---

## 3. 两级判重

| 级别 | 机制 | 挡什么 |
|---|---|---|
| 一级（身份） | `event_id` PRIMARY KEY / UNIQUE | 传输重复：重试、重发、重放 |
| 二级（内容） | `fingerprint` UNIQUE INDEX | hook 缺陷重复：同一事件双触发（不同 event_id、内容相同） |

**fingerprint 规范**：

```
canonical = join("|", [
  session_id ?? "",
  str(epoch_seconds(ts)),        # ts 截到秒，与时区写法无关
  model ?? "",
  provider ?? "",
  str(input_cache_hit.tokens),
  str(input_cache_miss.tokens),
  str(output.tokens),
  context.kind ?? "",
  status
])
fingerprint = sha256_hex_lowercase(canonical)   # 64 位十六进制
```

（`status=unknown, usage=null` 时三个 tokens 取 0。）

**误杀声明**：`恰好完全相同的两次真调用`（同秒、同模型、同 tokens）会被二级判重吞掉一条。**此场景可接受**——对账场景里重复计费比丢一条更糟。

**实现**：`INSERT OR IGNORE`，命中主键或唯一索引即 `duplicated += 1`，透明计数，不报错。

---

## 4. 存储与 TTL

统一 SQLite = **daemon 私有实现**：`<dataDir>/token-wallet.db`（与 app 同约定路径，但**仅 daemon 进程读写**）。

### 4.1 `usage_events` 表（daemon 建表，**DDL 权威 = 本节**）

```sql
CREATE TABLE IF NOT EXISTS usage_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,           -- 一级判重
  schema_version INTEGER NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('completed','partial','unknown')),
  agent_id       TEXT    NOT NULL,
  harness        TEXT    NOT NULL,
  session_id     TEXT,
  ts             TEXT    NOT NULL,                  -- ISO8601 原文
  ts_epoch       INTEGER NOT NULL,                  -- ts 解析为 unix 秒
  model          TEXT    NOT NULL DEFAULT '',
  provider       TEXT    NOT NULL DEFAULT '',
  in_hit_tokens  INTEGER, in_hit_cost  REAL, in_hit_currency  TEXT,
  in_miss_tokens INTEGER, in_miss_cost REAL, in_miss_currency TEXT,
  out_tokens     INTEGER, out_cost     REAL, out_currency     TEXT,
  total_cost     REAL,    total_currency TEXT,
  kanban_task    TEXT,
  kind           TEXT    NOT NULL DEFAULT 'other',
  usage_null     INTEGER NOT NULL DEFAULT 0,        -- 1 = status=unknown 的 usage:null 占位
  fingerprint    TEXT    NOT NULL UNIQUE,           -- 二级判重（§3）
  raw_json       TEXT    NOT NULL,                  -- 提交原文（usage_report_echo 数据源）
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_events_time        ON usage_events(ts_epoch);
CREATE INDEX IF NOT EXISTS idx_usage_events_agent_time  ON usage_events(agent_id, ts_epoch);
CREATE INDEX IF NOT EXISTS idx_usage_events_session     ON usage_events(session_id);
```

daemon 补算的 cost（§1.2）写回对应 `*_cost / *_currency` 列；`raw_json` 保持提交原文不变。

### 4.2 `usage_records` 扩列（core SCHEMA_SQL 所有权）

core 现表 `usage_records`（`packages/core/src/storage/schema-sql.ts`）扩一列：

```sql
-- SCHEMA_SQL 内权威形态（新建库直接含此列）
--   在 usage_records 列定义尾部追加：
--   source TEXT NOT NULL DEFAULT 'cloud'

-- 已存在的库（app 升级自动迁移）：
ALTER TABLE usage_records ADD COLUMN source TEXT NOT NULL DEFAULT 'cloud';
```

- `source` ∈ `'cloud' | 'agent'`，缺省 `'cloud'`（存量数据全是云通道语义）；
- daemon **每日聚合任务**把 `usage_events` 按天 × agent × model 聚合写入 `usage_records`：
  - `source='agent'`，`provider_id = 'agent:' || agent_id`，`model` 照抄；
  - `window_start` / `window_end` = 当天 00:00 / 次日 00:00（daemon 本地时区，epoch 秒，对齐现表语义）；
  - `tokens` = 三分项 tokens 之和；`status != 'unknown'` 的条目才参与聚合；
  - **币种**：daemon 价目表全集群一口价（USD），聚合行 `cost_cny` 列存 USD 数值（列名系历史遗留，为不破坏 app 兼容不改名）；币种权威视图仍是 §2.2 `usage_summary`；
- 聚合行供 app 长期趋势展示；**对账与明细永远以 `usage_events` / `usage_summary` 为准**。

### 4.3 TTL

- 配置化：env **`USAGE_TTL_DAYS`**，缺省 **90**；
- 每日维护任务（daemon 本地时区凌晨执行），顺序固定：**先聚合后删除**——
  1. 把前一天 `usage_events` 聚合写入 `usage_records`（§4.2）；
  2. `DELETE FROM usage_events WHERE ts_epoch < now - USAGE_TTL_DAYS 天`；
- 聚合表 `usage_records` **长期保留**，不参与 TTL。

---

## 5. 鉴权与部署

- **Bearer 一把 key**：env `TOKEN_WALLET_MCP_KEY`；Consul KV `ai-hermes/security/providers/token-wallet-mcp-key` 注入 env（照 kanban-mcp-server 的 `API_SERVER_KEY` 模式）；
- **不豁免 loopback**：本机请求同样必须带 key，全组件统一鉴权面；
- 端口 **9131**，端点路径 `/mcp`（fastmcp streamable-http 默认）；
- 常驻：**systemd user service**（照 kanban-mcp-server-ops 模式：`Restart=on-failure` + 防误杀超时）；
- 服务注册：**Consul**（ai-microservice-registry 模式，服务名 `token-wallet-mcp`）；
- 实现：**Python fastmcp** + 官方 MCP streamable-http transport；daemon 侧 schema 用 **pydantic 照本文档 §1–§2 实现**；hook 侧 TS **zod** 由 hook 卡实现；
- **跨实现一致性靠 fixture**：§8 的 5 组正/反例是共享测试向量，pydantic 与 zod 两套实现对每组 fixture 的 accept/reject 结论必须一致（各自测试内嵌）。

---

## 6. 本地模式例外（边界）

- **无 daemon 时**：app 本地引擎自采自读自己的库——单机单进程自产自销，**不违反唯一数据面**（数据面 = 本地引擎自身）；
- **装 daemon 后**：app 切远程模式（指向 :9131），**停止本地采集**（token-monitor 退避模式：发现远程数据面存在即让位）；
- hook 永远只对 MCP 上报，不感知本地模式的存在。

---

## 7. hook 适配规范（行为约定，实现归 hook 卡）

- **提取点**：`post_llm_call`（成功调用 → `completed`）；`on_stream_end`（流被 cancel → 判 `partial`：拿到了部分 usage；`unknown`：拿不到 usage，`usage: null` 占位）；
- **缓冲**：内存 buffer；flush 条件 = **满 50 条 ∨ 60s 定时 ∨ 会话结束**；
- **断线排队**：daemon 不可达时内存排队，恢复后补发（整批原样重发，event_id 幂等，见 §2.1 语义 6）；
- **零阻塞**：hook 本体只入 buffer，flush 全异步，绝不阻塞 agent 主流程；
- **不重发 `rejected`** 条目（§2.1）。

---

## 8. Fixtures（5 组共享测试向量）

> 约定：以下每组给出输入与期望结论。pydantic（daemon）与 zod（hook）测试都必须内嵌全部 5 组。

### F1 正常 completed（期望：accepted=1）

```json
{
  "reports": [{
    "schema_version": 1,
    "event_id": "01912345-6789-7abc-8def-0123456789ab",
    "status": "completed",
    "agent_id": "home-computer",
    "harness": "hermes",
    "session_id": "20260906_014855_4c76c5",
    "ts": "2026-09-06T01:49:30.123+08:00",
    "model": "glm-5.3-flash",
    "provider": "zai",
    "usage": {
      "input_cache_hit":  { "tokens": 15230, "cost": null, "currency": null },
      "input_cache_miss": { "tokens": 1200,  "cost": null, "currency": null },
      "output":           { "tokens": 845,   "cost": null, "currency": null },
      "total":            { "cost": null, "currency": null }
    },
    "context": { "kanban_task": "t_586ae6ac", "kind": "coding" }
  }]
}
```

期望结果：`{"accepted": 1, "duplicated": 0, "rejected": []}`；daemon 按价目表补算 cost。

### F2 partial（流式被 cancel，报已收部分；期望：accepted=1）

```json
{
  "reports": [{
    "schema_version": 1,
    "event_id": "01912345-6789-7abc-8def-0123456789ac",
    "status": "partial",
    "agent_id": "njbx02",
    "harness": "hermes",
    "session_id": "20260906_020000_aaa111",
    "ts": "2026-09-06T02:00:10+08:00",
    "model": "glm-5.3-flash",
    "provider": "zai",
    "usage": {
      "input_cache_hit":  { "tokens": 9000, "cost": null, "currency": null },
      "input_cache_miss": { "tokens": 500,  "cost": null, "currency": null },
      "output":           { "tokens": 210,  "cost": null, "currency": null },
      "total":            { "cost": null, "currency": null }
    },
    "context": { "kanban_task": null, "kind": "chat" }
  }]
}
```

期望结果：`accepted=1`；`usage_summary` 中该条计入 tokens 与 `by_status.partial`。

### F3 unknown（拿不到 usage 的占位；期望：accepted=1，不计 tokens）

```json
{
  "reports": [{
    "schema_version": 1,
    "event_id": "01912345-6789-7abc-8def-0123456789ad",
    "status": "unknown",
    "agent_id": "desktop-e5jupfs",
    "harness": "opencode",
    "session_id": null,
    "ts": "2026-09-06T02:05:00+08:00",
    "model": "",
    "provider": "",
    "usage": null,
    "context": { "kanban_task": null, "kind": "other" }
  }]
}
```

期望结果：`accepted=1`；`usage_summary` 只进 `calls` / `by_status.unknown`，token 三项不计。

### F4 重复（期望：duplicated，不是错误）

同一 event_id 重发（一级判重）——即 F1 原文再发一次：

```json
{
  "reports": [{
    "schema_version": 1,
    "event_id": "01912345-6789-7abc-8def-0123456789ab",
    "status": "completed",
    "agent_id": "home-computer",
    "harness": "hermes",
    "session_id": "20260906_014855_4c76c5",
    "ts": "2026-09-06T01:49:30.123+08:00",
    "model": "glm-5.3-flash",
    "provider": "zai",
    "usage": {
      "input_cache_hit":  { "tokens": 15230, "cost": null, "currency": null },
      "input_cache_miss": { "tokens": 1200,  "cost": null, "currency": null },
      "output":           { "tokens": 845,   "cost": null, "currency": null },
      "total":            { "cost": null, "currency": null }
    },
    "context": { "kanban_task": "t_586ae6ac", "kind": "coding" }
  }]
}
```

期望结果：`{"accepted": 0, "duplicated": 1, "rejected": []}`。

**变体 F4b（二级判重）**：内容与 F1 完全相同、仅 event_id 不同：

```json
{
  "reports": [{
    "schema_version": 1,
    "event_id": "01912345-6789-7abc-8def-0123456789ae",
    "status": "completed",
    "agent_id": "home-computer",
    "harness": "hermes",
    "session_id": "20260906_014855_4c76c5",
    "ts": "2026-09-06T01:49:30.123+08:00",
    "model": "glm-5.3-flash",
    "provider": "zai",
    "usage": {
      "input_cache_hit":  { "tokens": 15230, "cost": null, "currency": null },
      "input_cache_miss": { "tokens": 1200,  "cost": null, "currency": null },
      "output":           { "tokens": 845,   "cost": null, "currency": null },
      "total":            { "cost": null, "currency": null }
    },
    "context": { "kanban_task": "t_586ae6ac", "kind": "coding" }
  }]
}
```

期望结果：`{"accepted": 0, "duplicated": 1, "rejected": []}`（fingerprint 命中 UNIQUE）。

### F5 坏 schema（期望：rejected 逐条明细，不回滚合法条目）

```json
{
  "reports": [
    { "schema_version": 1, "event_id": "01912345-6789-7abc-8def-0123456789af",
      "status": "ok",
      "agent_id": "njbx02", "harness": "hermes", "session_id": null,
      "ts": "2026-09-06T02:10:00+08:00", "model": "glm-5.3-flash", "provider": "zai",
      "usage": { "input_cache_hit": { "tokens": -5, "cost": null, "currency": null },
                 "input_cache_miss": { "tokens": 0, "cost": null, "currency": null },
                 "output": { "tokens": 0, "cost": null, "currency": null },
                 "total": { "cost": null, "currency": null } },
      "context": { "kanban_task": null, "kind": "chat" } },
    { "schema_version": 1, "event_id": "not-a-uuid",
      "status": "completed", "agent_id": "njbx02", "harness": "hermes",
      "session_id": null, "ts": "2026-09-06T02:10:01+08:00",
      "model": "glm-5.3-flash", "provider": "zai",
      "usage": { "input_cache_hit": { "tokens": 1, "cost": null, "currency": null },
                 "input_cache_miss": { "tokens": 0, "cost": null, "currency": null },
                 "output": { "tokens": 0, "cost": null, "currency": null },
                 "total": { "cost": null, "currency": null } },
      "context": { "kanban_task": null, "kind": "chat" } },
    { "schema_version": 1, "event_id": "01912345-6789-7abc-8def-0123456789ab",
      "status": "completed",
      "agent_id": "home-computer", "harness": "hermes",
      "session_id": "20260906_014855_4c76c5",
      "ts": "2026-09-06T01:49:30.123+08:00",
      "model": "glm-5.3-flash", "provider": "zai",
      "usage": { "input_cache_hit":  { "tokens": 15230, "cost": null, "currency": null },
                 "input_cache_miss": { "tokens": 1200, "cost": null, "currency": null },
                 "output":           { "tokens": 845,  "cost": null, "currency": null },
                 "total":            { "cost": null, "currency": null } },
      "context": { "kanban_task": "t_586ae6ac", "kind": "coding" } }
  ]
}
```

期望结果：`{"accepted": 1, "duplicated": 0, "rejected": [
  {"index": 0, "event_id": "01912345-6789-7abc-8def-0123456789af",
   "error": "<status 枚举违例 + tokens 负数>"},
  {"index": 1, "event_id": "not-a-uuid", "error": "<event_id pattern 违例>"}
]}`——第 3 条（F1）照常落库（部分失败不回滚）；客户端**不重发** rejected 条目。

---

## 9. 开放问题

无阻塞项。备忘一条已定性事项：`usage_records.cost_cny` 列名与实际存 USD 值的错位（§4.2），系历史遗留兼容取舍，已在此登记，不做改列名破坏性变更。
