"""五段式文档页数据源 — /guide HTML 视图与 JSON doc 字段共用。

文档即产品 (20-strategy S1): 五段式 = 概述→认证→接口规格→真实示例→验证步骤。
单一事实源纪律 (S2): SCHEMA_JSON / ENVELOPE_JSON / EXAMPLE_PAYLOAD 三个常量
由 docs/mcp-protocol.md 程序化提取生成 (OB-01 落地时一次成文), 此后**禁手编**——
tests/test_doc_consistency.py 与权威源逐字比对, 篡改任一字符即红。
协议变更流程: 先改 docs/mcp-protocol.md, 再重新提取更新本文件常量。
"""
from __future__ import annotations

# 参考实现 (S5 单条目自适配标准 + REQ-05; OB-02 并 master 后该路径真实存在)
# gitee URL 结构 (2026-09-19 实测): 目录 = /tree/<branch>/<path> (GitLab 式 /-/tree/ 404), 文件 = /blob/<branch>/<path>
REFERENCE_IMPL_URL = (
    "https://gitee.com/ITEater/token-wallet/tree/master/packages/hook-usage-reporter"
)

# AgentUsageReport v1 全 schema — 逐字 = docs/mcp-protocol.md §1.1
SCHEMA_JSON = r'''

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
      "description": "agent 标识，如 hermes-njbx02 | claude-code-ws1 | any-custom-id" },
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
}'''

# report_usage 批量信封 — 逐字 = docs/mcp-protocol.md §1.1 批量信封
ENVELOPE_JSON = r'''

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
}'''

# 真实示例 payload — 逐字 = docs/mcp-protocol.md §8 F1 fixture (S3 禁手编)
EXAMPLE_PAYLOAD = r'''

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
}'''



def jsonrpc_example() -> str:
    """可整段复制的 report_usage JSONRPC 调用 — arguments 即 F1 fixture 原文。

    JSON 对空白不敏感: EXAMPLE_PAYLOAD 逐字嵌入不重排缩进 (S3 禁手编),
    测试守护 arguments 与 EXAMPLE_PAYLOAD 逐字一致。
    """
    return (
        '{\n'
        '  "jsonrpc": "2.0",\n'
        '  "id": 1,\n'
        '  "method": "tools/call",\n'
        '  "params": {\n'
        '    "name": "report_usage",\n'
        '    "arguments": ' + EXAMPLE_PAYLOAD.strip() + '\n'
        '  }\n'
        '}'
    )


def doc_sections() -> list[dict]:
    """五段式文档分段 (S1)。HTML 模板与 JSON doc 字段同一数据源。

    item 形态: p(正文) | ul(列表) | ol(有序步骤) | code(代码块, lang)
              | link(text+href) — 均为纯数据, 渲染归 _render_guide_html。
    """
    return [
        {
            "id": "overview",
            "title": "概述",
            "items": [
                {"type": "p", "text": (
                    "token-wallet MCP daemon 是本机/局域网内的 AI 用量数据面："
                    "任何 agent（无论使用何种 harness）都可以通过标准 MCP 协议把每次 "
                    "LLM 调用的 token 用量上报进来，并在聚合视图里查询。"
                    "接入无需为特定 agent 定制适配器——按本页五段式标准自助完成即可。"
                )},
                {"type": "ul", "items": [
                    "拿到 endpoint 与 Bearer key（见「认证」）",
                    "实现 report_usage 上报（见「接口规格」与「真实示例」）",
                    "用 usage_summary / usage_report_echo 回读验证（见「验证步骤」）",
                ]},
                {"type": "p", "text": (
                    "参考实现：Hermes 官方 hook 适配器 hook-usage-reporter——"
                    "其他 agent 可参考其 hook 触发点设计（post_llm_call 提取点 / "
                    "buffer 策略 / 批量上报）自行实现适配。"
                )},
                {"type": "link", "text": "hook-usage-reporter（参考实现）", "href": REFERENCE_IMPL_URL},
            ],
        },
        {
            "id": "auth",
            "title": "认证",
            "items": [
                {"type": "p", "text": (
                    "MCP 端点 /mcp 的所有调用通过 Bearer 一把 key 鉴权；"
                    "本页与 /guide 的 JSON 视图除外（引导数据无密钥，可匿名读取）。"
                )},
                {"type": "ul", "items": [
                    "key 来源：向用户索取——用户在 token-wallet app 设置页 MCP 区块复制 key"
                    "（或查看 daemon 侧 mcp.env 的 TOKEN_WALLET_MCP_KEY）；"
                    "key 由用户自行生成（如 openssl rand -hex 32）",
                    "请求头形态：Authorization: Bearer <key>",
                    "endpoint 见本页顶部（形如 http://<host>:9131/mcp，展示的是局域网可访问地址）",
                ]},
                {"type": "p", "text": (
                    "key 是敏感凭据：不要写进 URL、日志或示例 payload——"
                    "本页所有示例均不包含真实 key 值。"
                )},
            ],
        },
        {
            "id": "api",
            "title": "接口规格",
            "items": [
                {"type": "p", "text": (
                    "MCP 工具面共 3 个工具（v1 冻结）：report_usage（写，批量上报 1–100 条）、"
                    "usage_summary（读聚合）、usage_report_echo（读原文回读）。"
                    "传输为 MCP streamable-http，Bearer 鉴权。"
                )},
                {"type": "p", "text": (
                    "上报数据 AgentUsageReport v1 的 JSON Schema 全文如下"
                    "（与 docs/mcp-protocol.md §1.1 逐字一致，由一致性测试守护）："
                )},
                {"type": "code", "lang": "json", "code": SCHEMA_JSON.strip()},
                {"type": "p", "text": "report_usage 的输入为批量信封（1–100 条 reports）："},
                {"type": "code", "lang": "json", "code": ENVELOPE_JSON.strip()},
                {"type": "p", "text": (
                    "字段语义要点：四分项 input_cache_hit / input_cache_miss / output "
                    "统一为 {tokens, cost, currency}，total 只有 {cost, currency}"
                    "（求和结果，无 tokens）；cost / currency 可 null——agent 只保证 "
                    "tokens 忠实，计价由 daemon 侧价目表补算。status 三态："
                    "completed（正常结束，usage 完整）/ partial（流式被 cancel，"
                    "报已收到的部分——钱花了要记，残缺要标记）/ unknown（拿不到 usage，"
                    "usage:null 占位，不计入 token 聚合）。event_id 为 uuidv7，"
                    "hook 在事件点生成，重试/重发/重放必须复用同一 event_id。"
                    "ts 为事件发生时刻（ISO8601 带时区偏移），聚合窗口按它过滤，不按入库时间。"
                )},
                {"type": "p", "text": (
                    "幂等与两级判重：一级 = event_id PRIMARY KEY，挡传输重复"
                    "（重试、重发、重放，原样重发安全）；二级 = fingerprint（上报内容 sha256）"
                    "UNIQUE，挡 hook 缺陷导致的同事件双触发。误杀声明：恰好完全相同的两次真调用"
                    "（同秒、同模型、同 tokens）会被二级判重吞掉一条——此场景可接受，"
                    "对账场景重复计费比丢一条更糟。实现为 INSERT OR IGNORE，"
                    "命中判重即 duplicated 计数，不报错。"
                )},
                {"type": "p", "text": (
                    "report_usage 返回 {accepted, duplicated, rejected}，恒有 "
                    "accepted + duplicated + rejected.length == reports.length；"
                    "duplicated 不是错误；rejected 为逐条 schema 校验失败明细"
                    "（含 index / event_id / error）；同批部分失败不回滚，合法条目照常落库；"
                    "网络失败整批原样重发（event_id 幂等保证），被 rejected 的条目不重发"
                    "（重发仍会被拒）。"
                )},
            ],
        },
        {
            "id": "example",
            "title": "真实示例",
            "items": [
                {"type": "p", "text": (
                    "以下 report_usage 调用 payload 取自协议规范 §8 F1 fixture"
                    "（正常 completed 场景，期望 accepted=1），可整段复制："
                    "把 arguments 交给你的 MCP 客户端调用 report_usage 工具即可。"
                )},
                {"type": "code", "lang": "json", "code": jsonrpc_example()},
                {"type": "p", "text": (
                    '期望响应：{"accepted": 1, "duplicated": 0, "rejected": []}；'
                    "cost 为 null 时 daemon 按价目表补算。"
                )},
            ],
        },
        {
            "id": "verify",
            "title": "验证步骤",
            "items": [
                {"type": "ol", "items": [
                    "用同一客户端调用 usage_summary（最小输入：{\"group_by\": [\"agent\"]}），"
                    "确认返回 rows 中出现你上报的 agent_id，calls 计数增加",
                    "调 usage_report_echo 按 event_id 精确回读，"
                    "核对落库原文与上报内容一致（验收自证 + 对账原始视图）",
                    "幂等自证：把同一条 report 原样重发一次，"
                    "响应应为 duplicated 计数 +1 且不产生重复数据",
                    "坏数据行为自证：提交一条 schema 校验失败的 report，"
                    "确认进入 rejected 逐条明细（index / event_id / error），"
                    "同批合法条目照常落库",
                ]},
                {"type": "p", "text": (
                    "约束提醒：usage_summary 的 group_by 至多 3 维"
                    "（agent / provider / model / day / status）；"
                    "usage_report_echo 的 event_id 与 session_id 互斥、至多出现一个。"
                    "完整语义以 docs/mcp-protocol.md §2 为权威。"
                )},
            ],
        },
    ]
