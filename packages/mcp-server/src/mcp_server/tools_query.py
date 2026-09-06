"""usage_summary / usage_report_echo — spec §2.2 / §2.3。"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .schema import (
    ByStatus,
    SummaryRow,
    SummaryTotal,
    SummaryWindow,
    UsageReportEchoInput,
    UsageReportEchoOutput,
    UsageSummaryInput,
    UsageSummaryOutput,
)

STATUS_KEYS = ("completed", "partial", "unknown")
GROUP_DIMS = ("agent", "provider", "model", "day", "status")


class SummaryEngine:
    def __init__(self, conn: sqlite3.Connection, lock=None):
        self.conn = conn
        self._lock = lock  # EventStorage 的锁; None = 无并发(单测直连)

    # ------------------------------------------------------------------ #

    def summary(self, q: UsageSummaryInput) -> UsageSummaryOutput:
        where, params = self._filters(q)
        if self._lock is not None:
            with self._lock:
                rows = self.conn.execute(
                    f"""
                    SELECT agent_id, provider, model, status, ts_epoch,
                           in_hit_tokens, in_miss_tokens, out_tokens,
                           in_hit_cost, in_hit_currency,
                           in_miss_cost, in_miss_currency,
                           out_cost, out_currency, total_cost, total_currency
                    FROM usage_events{where}
                    """,
                    params,
                ).fetchall()
        else:
            rows = self.conn.execute(
                f"""
                SELECT agent_id, provider, model, status, ts_epoch,
                       in_hit_tokens, in_miss_tokens, out_tokens,
                       in_hit_cost, in_hit_currency,
                       in_miss_cost, in_miss_currency,
                       out_cost, out_currency, total_cost, total_currency
                FROM usage_events{where}
                """,
                params,
            ).fetchall()

        tz = timezone.utc  # daemon 本地时区; 部署机 njbx02 = CST(+08:00) 与 UTC 偏移一致语义
        since = self._parse_or(q.since, default_start=True)
        until = self._parse_or(q.until, default_start=False)

        groups: dict[tuple, dict[str, Any]] = {}
        for r in rows:
            ep = r["ts_epoch"]
            if ep < since or ep > until:
                continue
            key_parts = []
            for dim in q.group_by:
                key_parts.append(self._dim_value(dim, r, ep))
            key = tuple(key_parts)
            g = groups.setdefault(
                key,
                {
                    "calls": 0,
                    "hit": 0,
                    "miss": 0,
                    "out": 0,
                    "by_status": {k: 0 for k in STATUS_KEYS},
                    "currencies": defaultdict(float),
                },
            )
            g["calls"] += 1
            g["by_status"][r["status"]] = g["by_status"].get(r["status"], 0) + 1
            if r["status"] == "unknown":
                continue  # unknown 不计 tokens (§2.2), 只进 calls/by_status
            g["hit"] += r["in_hit_tokens"] or 0
            g["miss"] += r["in_miss_tokens"] or 0
            g["out"] += r["out_tokens"] or 0
            # 混币种分行 (§2.2): 按 (币种) 累计 cost; cost null 的条目不进 cost 合计
            self._accumulate_cost(g["currencies"], r)

        out_rows = [self._to_row(key, g) for key, g in sorted(groups.items(), key=lambda kv: kv[0])]
        total = self._to_total(out_rows)
        return UsageSummaryOutput(
            window=SummaryWindow(
                since=datetime.fromtimestamp(since, tz=tz).isoformat(),
                until=datetime.fromtimestamp(until, tz=tz).isoformat(),
            ),
            timezone="UTC" if tz == timezone.utc else str(tz),
            generated_at=datetime.now(tz).isoformat(),
            rows=out_rows,
            total=total,
        )

    # ------------------------------------------------------------------ #

    @staticmethod
    def _dim_value(dim: str, r: sqlite3.Row, ep: int) -> str:
        if dim == "agent":
            return r["agent_id"]
        if dim == "provider":
            return r["provider"] or ""
        if dim == "model":
            return r["model"] or ""
        if dim == "status":
            return r["status"]
        if dim == "day":
            return datetime.fromtimestamp(ep, tz=timezone.utc).strftime("%Y-%m-%d")
        raise ValueError(f"unknown group dim: {dim}")

    @staticmethod
    def _accumulate_cost(currencies: dict, r: sqlite3.Row) -> None:
        """行级 cost 归集: 三分项 *_cost + total_cost, 按 currency 累加。

        优先 total.{cost,currency} (hook 求和值); total 缺失时退三分项之和。
        currency 为 null 的 cost 记入特殊桶 '' (输出时 currency 标 null)。
        """
        entries: list[tuple[Optional[float], Optional[str]]] = []
        if r["total_cost"] is not None:
            entries.append((r["total_cost"], r["total_currency"]))
        else:
            for c_col, cur_col in (
                ("in_hit_cost", "in_hit_currency"),
                ("in_miss_cost", "in_miss_currency"),
                ("out_cost", "out_currency"),
            ):
                if r[c_col] is not None:
                    entries.append((r[c_col], r[cur_col]))
        for cost, cur in entries:
            currencies[cur or ""] += cost

    @staticmethod
    def _to_row(key: tuple, g: dict) -> SummaryRow:
        # 混币种行: >1 币种 → cost_total=null, currency=null (不做汇率换算)
        if len(g["currencies"]) == 1:
            cur, amount = next(iter(g["currencies"].items()))
            cost_total: Optional[float] = round(amount, 6)
            currency: Optional[str] = cur or None
        else:
            cost_total, currency = None, None
        return SummaryRow(
            group="|".join(key),
            calls=g["calls"],
            input_cache_hit_tokens=g["hit"],
            input_cache_miss_tokens=g["miss"],
            output_tokens=g["out"],
            cost_total=cost_total,
            currency=currency,
            by_status=ByStatus(**g["by_status"]),
        )

    @staticmethod
    def _to_total(rows: list[SummaryRow]) -> SummaryTotal:
        calls = sum(r.calls for r in rows)
        hit = sum(r.input_cache_hit_tokens for r in rows)
        miss = sum(r.input_cache_miss_tokens for r in rows)
        out = sum(r.output_tokens for r in rows)
        by_status = ByStatus(
            completed=sum(r.by_status.completed for r in rows),
            partial=sum(r.by_status.partial for r in rows),
            unknown=sum(r.by_status.unknown for r in rows),
        )
        curs = {r.currency for r in rows if r.currency is not None}
        if len(curs) == 1 and all(r.cost_total is not None for r in rows) and rows:
            cost_total: Optional[float] = round(sum(r.cost_total for r in rows), 6)
            currency: Optional[str] = next(iter(curs))
        else:
            cost_total, currency = None, None
        return SummaryTotal(
            calls=calls,
            input_cache_hit_tokens=hit,
            input_cache_miss_tokens=miss,
            output_tokens=out,
            cost_total=cost_total,
            currency=currency,
            by_status=by_status,
        )

    def _filters(self, q: UsageSummaryInput) -> tuple[str, list]:
        where, params = [], []
        if q.agent_id is not None:
            where.append("agent_id = ?")
            params.append(q.agent_id)
        if q.provider is not None:
            where.append("provider = ?")
            params.append(q.provider)
        if q.model is not None:
            where.append("model = ?")
            params.append(q.model)
        if q.kanban_task is not None:
            where.append("kanban_task = ?")
            params.append(q.kanban_task)
        if q.since is not None:
            where.append("ts_epoch >= ?")
            params.append(int(self._parse_or(q.since, default_start=True)))
        if q.until is not None:
            where.append("ts_epoch <= ?")
            params.append(int(self._parse_or(q.until, default_start=False)))
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        return clause, params

    @staticmethod
    def _parse_or(ts: Optional[str], *, default_start: bool) -> float:
        """since 缺省 = 今天 00:00 (daemon 本地时区); until 缺省 = 当前时刻 (§2.2)。"""
        if ts:
            from .schema import parse_ts

            return parse_ts(ts).timestamp()
        now = datetime.now(timezone.utc).astimezone()
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return day_start.timestamp() if default_start else now.timestamp()


class EchoEngine:
    def __init__(self, storage):
        self.storage = storage

    def echo(self, q: UsageReportEchoInput) -> UsageReportEchoOutput:
        from .schema import parse_ts

        since_epoch = int(parse_ts(q.since).timestamp()) if q.since else None
        until_epoch = int(parse_ts(q.until).timestamp()) if q.until else None
        events, total = self.storage.query_events(
            event_id=q.event_id,
            session_id=q.session_id,
            since_epoch=since_epoch,
            until_epoch=until_epoch,
            limit=q.limit,
        )
        return UsageReportEchoOutput(events=events, total_count=total)
