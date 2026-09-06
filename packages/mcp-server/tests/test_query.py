"""聚合查询测试: usage_summary 对账 + echo + TTL 先聚合后删。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import pytest  # noqa: E402

from fixtures import ALL_FIXTURES  # noqa: E402
from mcp_server import maintenance  # noqa: E402
from mcp_server.schema import (  # noqa: E402
    UsageReportEchoInput,
    UsageSummaryInput,
)
from mcp_server.storage import EventStorage  # noqa: E402
from mcp_server.tools_query import EchoEngine, SummaryEngine  # noqa: E402
from mcp_server.tools_report import report_usage  # noqa: E402


@pytest.fixture()
def storage(tmp_path):
    return EventStorage(tmp_path / "test.db")


@pytest.fixture()
def engines(storage):
    return SummaryEngine(storage.conn), EchoEngine(storage)


class TestSummary:
    def test_F1_F2_F3_account(self, storage, engines):
        """对账: F1+F2+F3 落库后, 按 agent 聚合数字与 echo 原始流水一致。"""
        for key in ("F1", "F2", "F3"):
            assert report_usage(ALL_FIXTURES[key], storage)["accepted"] == 1
        summary, echo = engines

        out = summary.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00", group_by=["agent"]))
        by_group = {r.group: r for r in out.rows}
        assert set(by_group) == {"home-computer", "njbx02", "desktop-e5jupfs"}

        # F1 (§8): 15230 / 1200 / 845
        hc = by_group["home-computer"]
        assert (hc.input_cache_hit_tokens, hc.input_cache_miss_tokens,
                hc.output_tokens) == (15230, 1200, 845)
        assert hc.by_status.completed == 1

        # F2 partial 正常计 tokens: 9000/500/210
        nj = by_group["njbx02"]
        assert (nj.input_cache_hit_tokens, nj.input_cache_miss_tokens,
                nj.output_tokens) == (9000, 500, 210)
        assert nj.by_status.partial == 1

        # F3 unknown: tokens 三项不计, 只进 calls/by_status
        de = by_group["desktop-e5jupfs"]
        assert (de.input_cache_hit_tokens, de.input_cache_miss_tokens,
                de.output_tokens) == (0, 0, 0)
        assert de.calls == 1 and de.by_status.unknown == 1

        # total 对账 = 各行之和
        assert out.total.calls == 3
        assert out.total.input_cache_hit_tokens == 15230 + 9000
        assert out.total.by_status.unknown == 1

        # generated_at / timezone / window 字段齐备
        assert out.timezone and out.generated_at
        assert out.window.since <= out.window.until

    def test_echo_matches_summary(self, storage, engines):
        """验收口径: usage_summary 按 agent 聚合 ↔ echo 原始流水对账一致。"""
        for key in ("F1", "F2", "F3"):
            report_usage(ALL_FIXTURES[key], storage)
        summary, echo = engines

        events, total = echo.echo(UsageReportEchoInput(limit=50)).events, None
        out = echo.echo(UsageReportEchoInput(limit=50))
        assert out.total_count == 3 and len(out.events) == 3
        raw_by_agent = {}
        for ev in out.events:
            a = raw_by_agent.setdefault(ev["agent_id"], {"hit": 0, "miss": 0, "out": 0})
            u = ev.get("usage")
            if u:
                a["hit"] += u["input_cache_hit"]["tokens"]
                a["miss"] += u["input_cache_miss"]["tokens"]
                a["out"] += u["output"]["tokens"]

        s = summary.summary(UsageSummaryInput(group_by=["agent"]))
        for row in s.rows:
            raw = raw_by_agent[row.group]
            assert row.input_cache_hit_tokens == raw["hit"]
            assert row.input_cache_miss_tokens == raw["miss"]
            assert row.output_tokens == raw["out"]

    def test_group_by_day(self, storage, engines):
        summary, _ = engines
        report_usage(ALL_FIXTURES["F1"], storage)
        out = summary.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00", group_by=["agent", "day"]))
        assert len(out.rows) == 1
        assert out.rows[0].group == "home-computer|2026-09-05"  # ts=+08:00 01:49 → UTC 09-05 17:49
        assert out.rows[0].calls == 1

    def test_group_by_status(self, storage, engines):
        for key in ("F1", "F2", "F3"):
            report_usage(ALL_FIXTURES[key], storage)
        summary, _ = engines
        out = summary.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00", group_by=["status"]))
        groups = {r.group: r for r in out.rows}
        assert set(groups) == {"completed", "partial", "unknown"}
        assert groups["unknown"].calls == 1
        assert groups["unknown"].output_tokens == 0

    def test_window_filter(self, storage, engines):
        for key in ("F1", "F2"):
            report_usage(ALL_FIXTURES[key], storage)
        summary, _ = engines
        # F1 ts=01:49:30+08:00, F2 ts=02:00:10+08:00 → 以 01:55+08:00 切窗
        out = summary.summary(UsageSummaryInput(since="2026-09-06T01:55:00+08:00"))
        assert out.total.calls == 1
        assert out.total.input_cache_hit_tokens == 9000  # 只剩 F2

    def test_echo_by_event_id_and_mutex(self, storage, engines):
        report_usage(ALL_FIXTURES["F1"], storage)
        _, echo = engines
        out = echo.echo(UsageReportEchoInput(
            event_id="01912345-6789-7abc-8def-0123456789ab"))
        assert out.total_count == 1
        assert out.events[0]["event_id"].endswith("89ab")
        with pytest.raises(Exception):
            echo.echo(UsageReportEchoInput(
                event_id="x", session_id="y"))  # 互斥

    def test_echo_limit_and_total_count(self, storage, engines):
        """total_count 不受 limit 影响 (§2.3)。"""
        base = ALL_FIXTURES["F1"]["reports"][0]
        import copy
        for i in range(5):
            r = copy.deepcopy(base)
            r["event_id"] = f"01912345-6789-7abc-8def-{i:012x}"
            r["ts"] = f"2026-09-06T0{i}:00:00+08:00"
            report_usage({"reports": [r]}, storage)
        _, echo = engines
        out = echo.echo(UsageReportEchoInput(limit=2))
        assert out.total_count == 5 and len(out.events) == 2


class TestTtlMaintenance:
    def test_aggregate_then_delete(self, storage, engines):
        """验收: TTL 维护手动触发, 先聚合后删 — 聚合数字与删前流水对账一致。"""
        for key in ("F1", "F2", "F3"):
            report_usage(ALL_FIXTURES[key], storage)
        summary, _ = engines
        before = summary.summary(
            UsageSummaryInput(since="2026-09-01T00:00:00+08:00", group_by=["agent"]))
        before_by_group = {r.group: r for r in before.rows}

        storage.ensure_usage_records_table()
        # 聚合 F1/F2/F3 各自所在日 (ts 落在 2026-09-05 UTC / 09-06 +08)
        days = {int(r.ts_dt.timestamp()) // 86400 * 86400
                for k in ("F1", "F2", "F3")
                for r in [_report_of(k)]}
        for d in days:
            maintenance.aggregate_day(storage.conn, d)

        # usage_records 聚合行: source='agent', tokens = miss + out (comment #1092 口径)
        rows = storage.conn.execute(
            "SELECT * FROM usage_records WHERE source='agent'").fetchall()
        by_pid = {(r["provider_id"], r["model"]): r for r in rows}
        assert ("agent:home-computer", "glm-5.3-flash") in by_pid
        hc = by_pid[("agent:home-computer", "glm-5.3-flash")]
        assert hc["tokens"] == 1200 + 845  # miss + out, cache_hit 不进 tokens 列
        assert hc["window_end"] - hc["window_start"] == 86400

        # unknown 不参与聚合 → 无 desktop-e5jupfs 行
        assert not any(r["provider_id"] == "agent:desktop-e5jupfs" for r in rows)

        # 删除: TTL=1 天, now 设在事件次日 → 全删; usage_records 保留
        deleted = maintenance.purge_expired(
            storage.conn, ttl_days=1,
            now_epoch=max(d + 86400 for d in days) + 86400)
        n = storage.conn.execute("SELECT COUNT(*) c FROM usage_events").fetchone()["c"]
        assert n == 0 and deleted == 3
        rows_after = storage.conn.execute(
            "SELECT COUNT(*) c FROM usage_records WHERE source='agent'").fetchone()["c"]
        assert rows_after == len(rows)  # 聚合表长期保留

        # 删前 summary 与聚合行对账 (hc tokens: summary miss+out)
        assert before_by_group["home-computer"].input_cache_miss_tokens \
            + before_by_group["home-computer"].output_tokens == hc["tokens"]

    def test_daily_maintenance_entry(self, storage):
        """daily_maintenance 入口: 先聚合后删的顺序 + 返回对账数字。"""
        report_usage(ALL_FIXTURES["F2"], storage)
        storage.ensure_usage_records_table()
        # now = 事件次日中午 → 昨日聚合应含 F2
        from datetime import datetime, timedelta, timezone
        now = datetime(2026, 9, 7, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        result = maintenance.daily_maintenance(storage.conn, ttl_days=90, now=now)
        assert result["aggregated_rows"] == 1
        assert result["deleted_events"] == 0  # TTL 90 天, 事件昨天, 不删
        rows = storage.conn.execute(
            "SELECT provider_id, tokens FROM usage_records WHERE source='agent'").fetchall()
        assert rows and rows[0]["tokens"] == 500 + 210

    def test_aggregate_idempotent(self, storage):
        """同一天重跑聚合不产生重复行 (派生数据重算语义)。"""
        report_usage(ALL_FIXTURES["F2"], storage)
        storage.ensure_usage_records_table()
        day = int(_report_of("F2").ts_dt.timestamp()) // 86400 * 86400
        maintenance.aggregate_day(storage.conn, day)
        maintenance.aggregate_day(storage.conn, day)
        n = storage.conn.execute(
            "SELECT COUNT(*) c FROM usage_records WHERE source='agent'").fetchone()["c"]
        assert n == 1


def _report_of(key):
    from mcp_server.schema import UsageReport
    return UsageReport.model_validate(ALL_FIXTURES[key]["reports"][0])
