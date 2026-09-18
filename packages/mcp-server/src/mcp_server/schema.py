"""AgentUsageReport v1 pydantic 模型 — 权威源 docs/mcp-protocol.md §1。

逐字段对齐 spec JSON Schema (draft 2020-12):
- additionalProperties:false → extra="forbid"
- required → 字段不带默认值 (缺字段 = 校验失败)
- 交叉校验 (spec 终审 P2 #2 硬性要求): status ∈ {completed, partial} 且
  usage: null → reject (spec §1.1 oneOf null 分支无 if/then 守卫, 校验是实现层责任)
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, field_validator, model_validator

UUIDV7_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def parse_ts(ts: str) -> datetime:
    """ISO8601 → aware datetime; 必须带时区偏移 (spec §1.2: 聚合窗口按 ts 过滤)。"""
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError as e:
        raise ValueError(f"ts must be ISO8601 date-time: {e}") from e
    if dt.tzinfo is None:
        raise ValueError("ts must carry a timezone offset")
    return dt


class TokenCost(BaseModel):
    """spec §1.1 $defs.token_cost — {tokens(必填), cost?, currency?}。"""

    model_config = ConfigDict(extra="forbid")

    tokens: StrictInt = Field(ge=0)
    cost: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = None


class CostOnly(BaseModel):
    """spec §1.1 $defs.cost_only — total 专用, 只有 {cost?, currency?} 无 tokens。"""

    model_config = ConfigDict(extra="forbid")

    cost: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = None


class UsageBody(BaseModel):
    """spec §1.1 $defs.usage_body — 四分项: 三 tokens 分项 + total(仅 cost)。"""

    model_config = ConfigDict(extra="forbid")

    input_cache_hit: TokenCost
    input_cache_miss: TokenCost
    output: TokenCost
    total: CostOnly


class ReportContext(BaseModel):
    """spec §1.1 properties.context — kind 必填, kanban_task 可空。"""

    model_config = ConfigDict(extra="forbid")

    kanban_task: Optional[str] = None
    kind: Literal["coding", "review", "chat", "cron", "other"]


class UsageReport(BaseModel):
    """spec §1.1 AgentUsageReport — required 全字段无默认, usage 可 null。"""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    event_id: str
    status: Literal["completed", "partial", "unknown"]
    agent_id: str = Field(min_length=1)
    harness: Literal["hermes", "claude-code", "opencode", "codex", "other"]
    session_id: Optional[str]
    ts: str
    model: str
    provider: str
    usage: Optional[UsageBody]
    context: ReportContext

    @field_validator("event_id")
    @classmethod
    def _uuid_v7(cls, v: str) -> str:
        if not UUIDV7_PATTERN.fullmatch(v):
            raise ValueError("event_id must match uuidv7 pattern")
        return v

    @field_validator("ts")
    @classmethod
    def _iso_with_tz(cls, v: str) -> str:
        parse_ts(v)
        return v

    @model_validator(mode="after")
    def _status_usage_cross_check(self) -> "UsageReport":
        """交叉校验 (终审 P2 #2): completed/partial 必须带 usage 体。"""
        if self.status in ("completed", "partial") and self.usage is None:
            raise ValueError(
                f"status={self.status!r} requires a usage body; usage:null is only "
                "allowed for status='unknown' (spec §1.2 cross-constraint)"
            )
        return self

    @property
    def ts_dt(self) -> datetime:
        return parse_ts(self.ts)


# ---------------------------------------------------------------------------
# 批量信封 (spec §1.1 ReportUsageInput) — 注意 maxItems 是 schema 约束,
# 信封里只有 reports 一个字段, 出现 maxItems 键会被 additionalProperties 拒。
# ---------------------------------------------------------------------------


class ReportUsageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reports: list[UsageReport] = Field(min_length=1, max_length=100)


# ---------------------------------------------------------------------------
# 工具输出模型 (spec §2)
# ---------------------------------------------------------------------------


class RejectedItem(BaseModel):
    """spec §2.1 output properties.rejected.items。"""

    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=0)
    event_id: Optional[str]
    error: str = Field(min_length=1)


class ReportUsageOutput(BaseModel):
    """不变量: accepted + duplicated + rejected.length == reports.length (§2.1)。"""

    model_config = ConfigDict(extra="forbid")

    accepted: int = Field(ge=0)
    duplicated: int = Field(ge=0)
    rejected: list[RejectedItem]


class SummaryWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    since: str
    until: str


class ByStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completed: int = Field(default=0, ge=0)
    partial: int = Field(default=0, ge=0)
    unknown: int = Field(default=0, ge=0)


class SummaryRow(BaseModel):
    """spec §2.2 $defs.summary_row。"""

    model_config = ConfigDict(extra="forbid")

    group: str
    calls: int = Field(ge=0)
    input_cache_hit_tokens: int = Field(ge=0)
    input_cache_miss_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cost_total: Optional[float]
    currency: Optional[str]
    by_status: ByStatus


class SummaryTotal(BaseModel):
    """混币种时 cost_total 与 currency 均为 null (不做汇率换算)。"""

    model_config = ConfigDict(extra="forbid")

    calls: int = Field(ge=0)
    input_cache_hit_tokens: int = Field(ge=0)
    input_cache_miss_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    cost_total: Optional[float]
    currency: Optional[str]
    by_status: ByStatus


class UsageSummaryInput(BaseModel):
    """spec §2.2 input — group_by ≤3 维, 缺省 ["agent"]。"""

    model_config = ConfigDict(extra="forbid")

    since: Optional[str] = None
    until: Optional[str] = None
    agent_id: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    kanban_task: Optional[str] = None
    group_by: list[Literal["agent", "provider", "model", "day", "status"]] = Field(
        default=["agent"], min_length=1, max_length=3
    )

    @model_validator(mode="after")
    def _unique_group_by(self) -> "UsageSummaryInput":
        if len(set(self.group_by)) != len(self.group_by):
            raise ValueError("group_by items must be unique")
        return self


class UsageSummaryOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    window: SummaryWindow
    timezone: str
    generated_at: str
    rows: list[SummaryRow]
    total: SummaryTotal


class UsageReportEchoInput(BaseModel):
    """spec §2.3 input — event_id 与 session_id 互斥, limit 1..500 缺省 50。"""

    model_config = ConfigDict(extra="forbid")

    event_id: Optional[str] = None
    session_id: Optional[str] = None
    since: Optional[str] = None
    until: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=500)

    @model_validator(mode="after")
    def _mutex(self) -> "UsageReportEchoInput":
        if self.event_id and self.session_id:
            raise ValueError("event_id and session_id are mutually exclusive")
        return self


class UsageReportEchoOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events: list[dict[str, Any]]
    total_count: int = Field(ge=0)


def format_validation_error(exc: ValidationError) -> str:
    """压成单行逐字段明细, 供 rejected[].error (spec §2.1: 逐条校验失败明细)。"""
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ())) or "<root>"
        parts.append(f"{loc}: {err['msg']}")
    return "; ".join(parts)


def extract_event_id(item: Any) -> Optional[str]:
    """从待校验条目里尽力提取 event_id, 提取不到为 None (rejected.event_id 语义)。"""
    if isinstance(item, dict):
        v = item.get("event_id")
        if isinstance(v, str):
            return v
    return None
