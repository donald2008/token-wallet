"""usage_summary / usage_report_echo — spec §2.2 / §2.3。

时区契约 (§2.2): day 分组 / since 缺省 / timezone 字段一律 daemon 本地时区,
响应 timezone = IANA 名 (如 Asia/Shanghai), App 不自行换算。
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
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
from .tzutil import local_tz

STATUS_KEYS = ("completed", "partial", "unknown")
GROUP_DIMS = ("agent", "provider", "model", "day", "status")
# 币种维度 (§2.2 混币种分行): 分组键尾部追加币种; 行 group 串不含币种
_NO_CURRENCY = "\0none"  # cost null 条目桶 (行 currency=null)

_SUMMARY_SELECT = """
    SELECT agent_id, provider, model, status, ts_epoch,
           in_hit_tokens, in_miss_tokens, out_tokens,
           in_hit_cost, in_hit_currency,
           in_miss_cost, in_miss_currency,
           out_cost, out_currency, total_cost, total_currency
    FROM usage_events{where}
"""


class SummaryEngine:
    def __init__(self, conn: sqlite3.Connection, lock=None, tz_name: Optional[str] = None):
        self.conn = conn
        self._lock = lock  # EventStorage 的锁; None = 无并发(单测直连)
        # daemon 本地时区 + IANA 名 (§2.2); 显式 tz_name 供测试注入
        self._tz, self._tz_name = local_tz(tz_env=tz_name)

    # ------------------------------------------------------------------ #

    def summary(self, q: UsageSummaryInput) -> UsageSummaryOutput:
        where, params = self._filters(q)
        with self._lock or _NULLLOCK:
            rows = self.conn.execute(_SUMMARY_SELECT.format(where=where), params).fetchall()

        tz = self._tz
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
            # 混币种按币种拆行 (§2.2): 币种进分组键, 同组 USD/CNY 各一行;
            # 无任何 cost 的条目单列一桶 (行 currency=null, 桶名不出现在 group 串)
            key_parts.append(self._currency_key(r))
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
            # 行级 cost 归集: 按 (币种) 累计; cost null 的条目不进 cost 合计
            self._accumulate_cost(g["currencies"], r)

        out_rows = [self._to_row(key, g) for key, g in sorted(groups.items(), key=lambda kv: kv[0])]
        total = self._to_total(out_rows)
        return UsageSummaryOutput(
            window=SummaryWindow(
                since=datetime.fromtimestamp(since, tz=tz).isoformat(),
                until=datetime.fromtimestamp(until, tz=tz).isoformat(),
            ),
            timezone=self._tz_name,
            generated_at=datetime.now(tz).isoformat(),
            rows=out_rows,
            total=total,
        )

    # ------------------------------------------------------------------ #

    def _dim_value(self, dim: str, r: sqlite3.Row, ep: int) -> str:
        if dim == "agent":
            return r["agent_id"]
        if dim == "provider":
            return r["provider"] or ""
        if dim == "model":
            return r["model"] or ""
        if dim == "status":
            return r["status"]
        if dim == "day":  # daemon 本地时区日界 (§2.2, 终审 P1: 禁 UTC 硬编码)
            return datetime.fromtimestamp(ep, tz=self._tz).strftime("%Y-%m-%d")
        raise ValueError(f"unknown group dim: {dim}")

    def _currency_key(self, r: sqlite3.Row) -> str:
        """行拆分的币种键 (§2.2 混币种分行): 该条目 cost 归属的币种。

        与 _accumulate_cost 同口径: total 优先, 缺则退三分项; 多分项币种以
        total 语义为准取第一个出现的 (同条目混币种 = hook 数据违例, 边缘可忽略);
        无任何 cost → _NO_CURRENCY 桶 (行 currency=null)。
        """
        if r["total_cost"] is not None:
            return r["total_currency"] or _NO_CURRENCY
        for c_col, cur_col in (
            ("in_hit_cost", "in_hit_currency"),
            ("in_miss_cost", "in_miss_currency"),
            ("out_cost", "out_currency"),
        ):
            if r[c_col] is not None:
                return r[cur_col] or _NO_CURRENCY
        return _NO_CURRENCY

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
        # 币种已在分组键尾位拆行 (§2.2): 单行内只会归集到一个币种 (或 null 桶)
        dims = key[:-1]
        cur_key = key[-1]
        if cur_key == _NO_CURRENCY:
            cost_total: Optional[float] = None
            currency: Optional[str] = None
        else:
            cost_total = round(g["currencies"].get(cur_key, 0.0), 6)
            currency = cur_key
        return SummaryRow(
            group="|".join(dims),
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

    def _parse_or(self, ts: Optional[str], *, default_start: bool) -> float:
        """since 缺省 = 今天 00:00 (daemon 本地时区, §2.2); until 缺省 = 当前时刻。"""
        if ts:
            from .schema import parse_ts

            return parse_ts(ts).timestamp()
        now = datetime.now(self._tz)
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return day_start.timestamp() if default_start else now.timestamp()


class _NullLock:
    """无并发场景 (单测直连) 的锁替身, 收敛 SummaryEngine 锁/无锁 SQL 双分支 (P3)。"""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


_NULLLOCK = _NullLock()


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
