"""report_usage — spec §2.1。

信封级校验失败 (reports 非数组/空/超100/顶层多字段) → 整个调用 tool error;
逐条 schema 失败 → rejected 明细; 部分失败不回滚。
"""
from __future__ import annotations

from typing import Any

from fastmcp.exceptions import ToolError
from pydantic import ValidationError

from . import pricing
from .schema import (
    RejectedItem,
    ReportUsageOutput,
    UsageReport,
    extract_event_id,
    format_validation_error,
)
from .storage import EventStorage, compute_fingerprint


def _apply_pricing(report) -> None:
    """cost=null 的分项按价目表补算 (§1.2); 价目表无此模型保持 null。"""
    if report.usage is None:
        return
    for name in ("input_cache_hit", "input_cache_miss", "output"):
        comp = getattr(report.usage, name)
        if comp.cost is None:
            cost, currency = pricing.compute_cost(name, comp.tokens, report.model)
            comp.cost = cost
            comp.currency = currency


def report_usage(payload: dict[str, Any], storage: EventStorage) -> dict:
    # 信封级校验只看结构 (§2.1 语义 5): reports 非法即整体 tool error
    if not isinstance(payload, dict) or set(payload) != {"reports"}:
        raise ToolError("envelope invalid: exactly one key 'reports' is required")
    reports = payload["reports"]
    if not isinstance(reports, list) or not (1 <= len(reports) <= 100):
        raise ToolError("envelope invalid: reports must be an array of 1..100 items")

    accepted = 0
    duplicated = 0
    rejected: list[RejectedItem] = []

    for idx, item in enumerate(reports):
        # 逐条 schema 校验 → 失败进 rejected 明细, 不回滚合法条目 (§2.1 语义 3/4)
        try:
            report = UsageReport.model_validate(item)
        except ValidationError as e:
            rejected.append(RejectedItem(
                index=idx, event_id=extract_event_id(item),
                error=format_validation_error(e),
            ))
            continue
        usage = report.usage
        if usage is None:  # unknown 占位: 三 tokens 取 0 (§3)
            hit = miss = out = 0
        else:
            hit, miss, out = (
                usage.input_cache_hit.tokens,
                usage.input_cache_miss.tokens,
                usage.output.tokens,
            )
            _apply_pricing(report)  # 落库前补算, 写回 *_cost 列 (raw_json 仍为原文)
        fp = compute_fingerprint(
            session_id=report.session_id,
            ts_epoch=int(report.ts_dt.timestamp()),
            model=report.model,
            provider=report.provider,
            hit_tokens=hit,
            miss_tokens=miss,
            out_tokens=out,
            kind=report.context.kind,
            status=report.status,
        )
        if storage.insert_report(report, fp):
            accepted += 1
        else:
            duplicated += 1  # 两级判重命中: 透明计数, 不是错误 (§3)

    out = ReportUsageOutput(accepted=accepted, duplicated=duplicated, rejected=rejected)
    # 不变量自检 (§2.1 语义 1): 三者之和 == reports.length
    assert accepted + duplicated + len(rejected) == len(reports)
    return out.model_dump()
