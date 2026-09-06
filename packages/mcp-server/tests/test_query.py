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
from mcp_server.storage import EventStorage, compute_fingerprint  # noqa: E402
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

        events = echo.echo(UsageReportEchoInput(limit=50)).events
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
        """day 日界 = daemon 本地时区 (§2.2, 终审 P1)。"""
        summary, _ = engines
        # 显式注入东八区 (三层二审 P3: 宿主时区不可控, 不得依赖宿主日界)
        from mcp_server.tools_query import SummaryEngine

        scoped = SummaryEngine(storage.conn, tz_name="Asia/Shanghai")
        report_usage(ALL_FIXTURES["F1"], storage)  # ts=2026-09-06 01:49:30+08:00
        out = scoped.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00",
                                               group_by=["agent", "day"]))
        # +08:00 09-06 01:49 在东八区属 09-06 (UTC 日界才会切到 09-05)
        assert out.rows[0].group == "home-computer|2026-09-06"
        assert out.rows[0].calls == 1

    def test_mixed_currency_split_rows(self, storage, engines):
        """混币种按币种分行 (§2.2): 同 agent 同窗口 USD 一行、CNY 一行。"""
        import copy

        summary, _ = engines
        base = ALL_FIXTURES["F1"]["reports"][0]
        usd = copy.deepcopy(base)
        usd["event_id"] = "01912345-6789-7abc-8def-0123456790ab"
        usd["usage"]["total"] = {"cost": 0.123, "currency": "USD"}
        cny = copy.deepcopy(base)
        cny["event_id"] = "01912345-6789-7abc-8def-0123456791ab"
        cny["ts"] = "2026-09-06T01:50:30+08:00"
        cny["usage"]["total"] = {"cost": 0.456, "currency": "CNY"}
        assert report_usage({"reports": [usd, cny]}, storage)["accepted"] == 2

        out = summary.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00",
                                                group_by=["agent"]))
        # 两行: group 相同 (dims 连接), currency 拆开
        assert len(out.rows) == 2
        by_cur = {r.currency: r for r in out.rows}
        assert set(by_cur) == {"USD", "CNY"}
        assert by_cur["USD"].cost_total == 0.123
        assert by_cur["CNY"].cost_total == 0.456
        assert by_cur["USD"].calls == 1 and by_cur["CNY"].calls == 1
        # tokens 按行归属 (每事件只进其币种行), total 混币种 → cost_total null
        assert by_cur["USD"].input_cache_miss_tokens == 1200
        assert out.total.calls == 2
        assert out.total.cost_total is None and out.total.currency is None

    def test_currency_null_cost_row_still_emitted(self, storage, engines):
        """无 cost 事件 (currency null) 单独成行, 不吞 tokens。"""
        import copy

        summary, _ = engines
        base = ALL_FIXTURES["F1"]["reports"][0]
        no_cost = copy.deepcopy(base)
        no_cost["event_id"] = "01912345-6789-7abc-8def-0123456792ab"
        no_cost["ts"] = "2026-09-06T01:51:30+08:00"
        assert report_usage({"reports": [no_cost]}, storage)["accepted"] == 1

        out = summary.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00",
                                                group_by=["agent"]))
        assert len(out.rows) == 1
        r = out.rows[0]
        assert r.currency is None and r.cost_total is None
        assert r.input_cache_miss_tokens == 1200  # cost null ≠ tokens 丢弃
        assert out.total.input_cache_miss_tokens == 1200

    def test_timezone_is_daemon_local_iana(self, storage, engines):
        """timezone 字段 = daemon 本地时区 IANA 名, day/since 缺省同口径 (§2.2)。"""
        # 显式注入时区 (CI 宿主时区不可控): 东八区固定断言
        from mcp_server.tools_query import SummaryEngine

        scoped = SummaryEngine(storage.conn, tz_name="Asia/Shanghai")
        report_usage(ALL_FIXTURES["F1"], storage)
        out = scoped.summary(UsageSummaryInput(since="2026-09-01T00:00:00+08:00",
                                               group_by=["agent", "day"]))
        assert out.timezone == "Asia/Shanghai"
        assert out.rows[0].group == "home-computer|2026-09-06"
        # since 缺省 = 今天 00:00 本地时区 → 昨天 F1 不在窗口内 (缺省窗)
        out_default = scoped.summary(UsageSummaryInput(group_by=["agent"]))
        assert out_default.total.calls == 0  # F1 ts=09-06, 今天(测试运行日)之后无事件
        # window.since 缺省值 = 本地时区当日 00:00 的 ISO 串 (+08:00)
        assert out_default.window.since.endswith("+08:00")

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

    def test_echo_computed_pinned_fingerprint_all_statuses(self, storage, engines):
        """echo _computed 钉住 (三层二审 P3): 全状态事件都有 fingerprint。

        fingerprint 与 usage_events 落库列一致 (照 §3 从原文重算), unknown
        事件 tokens_billable=0 且 _computed 非空。
        """
        for key in ("F1", "F3"):  # completed + unknown
            report_usage(ALL_FIXTURES[key], storage)
        _, echo = engines
        out = echo.echo(UsageReportEchoInput(limit=10))
        assert out.total_count == 2
        by_eid = {ev["event_id"]: ev for ev in out.events}
        for ev in out.events:
            comp = ev["_computed"]
            assert "fingerprint" in comp and len(comp["fingerprint"]) == 64
            # 与落库 fingerprint 列一致 (echo 回读 = 存储侧重算同源)
            row = storage.conn.execute(
                "SELECT fingerprint FROM usage_events WHERE event_id=?",
                (ev["event_id"],)).fetchone()
            assert comp["fingerprint"] == row["fingerprint"]
        # unknown (usage=null): tokens_billable=0, 无 computed_cost, fingerprint 照 §3
        unk = by_eid["01912345-6789-7abc-8def-0123456789ad"]
        assert unk["_computed"]["tokens_billable"] == 0
        assert "computed_cost" not in unk["_computed"]
        assert unk["_computed"]["fingerprint"] == compute_fingerprint(
            session_id=None, ts_epoch=int(_report_of("F3").ts_dt.timestamp()),
            model="", provider="", hit_tokens=0, miss_tokens=0, out_tokens=0,
            kind="other", status="unknown")


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
        # 聚合各事件所在「天」— 日界 = daemon 本地时区 (§4.2, 终审 P1 口径)
        from mcp_server.tzutil import day_bounds, local_tz
        tz, _ = local_tz()
        days = {day_bounds(int(r.ts_dt.timestamp()), tz)[0]
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

    def test_aggregate_cost_null_when_no_pricing(self, storage):
        """价目表为空 (补算不出 cost) → 聚合行 cost_cny=NULL, 非 0 (三层二审 P3)。"""
        report_usage(ALL_FIXTURES["F2"], storage)  # F2 全部 cost=null
        storage.ensure_usage_records_table()
        from mcp_server.tzutil import day_bounds, local_tz
        tz, _ = local_tz()
        day = day_bounds(int(_report_of("F2").ts_dt.timestamp()), tz)[0]
        maintenance.aggregate_day(storage.conn, day)
        rows = storage.conn.execute(
            "SELECT tokens, cost_cny FROM usage_records WHERE source='agent'").fetchall()
        assert len(rows) == 1
        assert rows[0]["cost_cny"] is None  # 零成本与无数据可区分
        assert rows[0]["tokens"] == 500 + 210

    def test_aggregate_idempotent(self, storage):
        """同一天重跑聚合不产生重复行 (派生数据重算语义)。"""
        report_usage(ALL_FIXTURES["F2"], storage)
        storage.ensure_usage_records_table()
        from mcp_server.tzutil import day_bounds, local_tz
        tz, _ = local_tz()
        day = day_bounds(int(_report_of("F2").ts_dt.timestamp()), tz)[0]
        maintenance.aggregate_day(storage.conn, day)
        maintenance.aggregate_day(storage.conn, day)
        n = storage.conn.execute(
            "SELECT COUNT(*) c FROM usage_records WHERE source='agent'").fetchone()["c"]
        assert n == 1


def _report_of(key):
    from mcp_server.schema import UsageReport
    return UsageReport.model_validate(ALL_FIXTURES[key]["reports"][0])
