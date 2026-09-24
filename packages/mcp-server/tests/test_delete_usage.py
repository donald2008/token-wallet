"""delete_usage 测试 (v1.1 增补, spec §2.4)。

覆盖: 整清 agent / 不存在 agent 幂等 0 / before_ts 时间上界 / 删除后
usage_summary 无该 agent / echo 回读不到 / 判重索引 (event_id+fingerprint)
同步清理 / 入参校验 (空 agent_id, 非法 before_ts, 多余字段)。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import pytest  # noqa: E402

from fixtures import ALL_FIXTURES  # noqa: E402
from mcp_server.schema import (  # noqa: E402
    DeleteUsageInput,
    UsageReport,
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


def _report_of(key: str) -> UsageReport:
    return UsageReport.model_validate(ALL_FIXTURES[key]["reports"][0])


class TestDeleteUsage:
    def test_delete_whole_agent(self, storage):
        """删除整 agent: 该 agent 全部行物理删除, 返回 deleted=N。"""
        for key in ("F1", "F2", "F3"):
            assert report_usage(ALL_FIXTURES[key], storage)["accepted"] == 1
        out = storage.delete_usage(agent_id="home-computer")
        assert out == 1
        n = storage.conn.execute(
            "SELECT COUNT(*) c FROM usage_events WHERE agent_id='home-computer'"
        ).fetchone()["c"]
        assert n == 0
        # 其他 agent 不受影响 (§2.4: 按 agent_id 精确删除)
        others = storage.conn.execute(
            "SELECT DISTINCT agent_id FROM usage_events ORDER BY agent_id"
        ).fetchall()
        assert [r["agent_id"] for r in others] == ["desktop-e5jupfs", "njbx02"]

    def test_unknown_agent_idempotent_zero(self, storage):
        """不存在 agent / 0 行 → deleted=0, 不报错 (幂等)。"""
        assert storage.delete_usage(agent_id="never-existed") == 0
        # 有数据的库里删不存在的 agent 同样 0
        report_usage(ALL_FIXTURES["F1"], storage)
        assert storage.delete_usage(agent_id="never-existed") == 0

    def test_repeat_delete_idempotent(self, storage):
        """重复删除幂等: 第二次 deleted=0。"""
        report_usage(ALL_FIXTURES["F1"], storage)
        assert storage.delete_usage(agent_id="home-computer") == 1
        assert storage.delete_usage(agent_id="home-computer") == 0

    def test_before_ts_upper_bound(self, storage):
        """before_ts 只删该时刻之前的事件 (严格上界 ts_epoch < before)。"""
        report_usage(ALL_FIXTURES["F1"], storage)  # ts=2026-09-06T01:49:30+08
        # 上界 = F1 事件整 1 分后 → F1 (01:49:30) 在上界之前, 被删
        epoch = int(_report_of("F1").ts_dt.timestamp()) + 60
        assert storage.delete_usage(agent_id="home-computer", before_epoch=epoch) == 1
        assert storage.conn.execute("SELECT COUNT(*) c FROM usage_events").fetchone()["c"] == 0

    def test_before_ts_strict_excludes_boundary(self, storage):
        """边界事件不被删: ts_epoch == before_epoch 的行保留 (< 严格小于)。"""
        r1 = _report_of("F1")
        storage.insert_report(r1, "fp-x")
        epoch = int(r1.ts_dt.timestamp())
        assert storage.delete_usage(agent_id="home-computer", before_epoch=epoch) == 0
        assert storage.delete_usage(agent_id="home-computer", before_epoch=epoch + 1) == 1

    def test_summary_no_agent_after_delete(self, storage, engines):
        """删除后 usage_summary 无该 agent (整清语义端到端)。"""
        for key in ("F1", "F2", "F3"):
            report_usage(ALL_FIXTURES[key], storage)
        summary, _ = engines
        storage.delete_usage(agent_id="njbx02")
        out = summary.summary(UsageSummaryInput(
            since="2026-09-01T00:00:00+08:00", group_by=["agent"]))
        assert "njbx02" not in {r.group for r in out.rows}
        assert set(r.group for r in out.rows) == {"home-computer", "desktop-e5jupfs"}

    def test_echo_cannot_read_after_delete(self, storage, engines):
        """删除后 echo 回读不到: events 空且 total_count=0。"""
        report_usage(ALL_FIXTURES["F1"], storage)
        _, echo = engines
        r1 = _report_of("F1")
        storage.delete_usage(agent_id="home-computer")
        out = echo.echo(UsageReportEchoInput(event_id=r1.event_id))
        assert out.total_count == 0 and out.events == []

    def test_dedup_indexes_cleared_too(self, storage):
        """判重索引同步清理: 删除后重报原 event_id 是新数据落库 (非 duplicated)。"""
        report_usage(ALL_FIXTURES["F1"], storage)
        storage.delete_usage(agent_id="home-computer")
        # 一级 (event_id): F1 原文重报 → accepted, 证明 event_id UNIQUE 不再挡
        out = report_usage(ALL_FIXTURES["F1"], storage)
        assert out == {"accepted": 1, "duplicated": 0, "rejected": []}
        # F4b 内容同 F1 仅 event_id 不同 → 命中【新落库 F1 行】的 fingerprint
        # (二级判重正常工作, 与删除语义无关); 先删空再验 fingerprint 索引已清:
        storage.delete_usage(agent_id="home-computer")
        out = report_usage(ALL_FIXTURES["F4b"], storage)
        assert out == {"accepted": 1, "duplicated": 0, "rejected": []}

    def test_fingerprint_freed_fingerprint_reusable(self, storage):
        """被删行的 fingerprint 不再占用 UNIQUE 索引 (直接插入同 fingerprint 行成功)。"""
        r1 = _report_of("F1")
        fp = compute_fingerprint(
            session_id=r1.session_id, ts_epoch=int(r1.ts_dt.timestamp()),
            model=r1.model, provider=r1.provider,
            hit_tokens=r1.usage.input_cache_hit.tokens,
            miss_tokens=r1.usage.input_cache_miss.tokens,
            out_tokens=r1.usage.output.tokens,
            kind=r1.context.kind, status=r1.status,
        )
        storage.insert_report(r1, fp)
        storage.delete_usage(agent_id="home-computer")
        # 同 fingerprint 再插 (新 event_id) — 索引已清, 不再冲突
        assert storage.insert_report(r1, fp) is True


class TestDeleteUsageInputModel:
    """§2.4 入参校验: agent_id 必填非空 / before_ts ISO8601 带时区 / 禁多余字段。"""

    def test_minimal(self):
        q = DeleteUsageInput(agent_id="a1")
        assert q.before_ts is None

    def test_with_before_ts(self):
        q = DeleteUsageInput(agent_id="a1", before_ts="2026-09-24T00:00:00+08:00")
        assert q.before_ts == "2026-09-24T00:00:00+08:00"

    def test_empty_agent_id_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DeleteUsageInput(agent_id="")

    def test_missing_agent_id_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DeleteUsageInput()

    def test_naive_before_ts_rejected(self):
        """before_ts 不带时区偏移 → 拒 (与 ts 同规格, §1.2/§2.4)。"""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DeleteUsageInput(agent_id="a1", before_ts="2026-09-24T00:00:00")

    def test_garbage_before_ts_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DeleteUsageInput(agent_id="a1", before_ts="not-a-date")

    def test_extra_field_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            DeleteUsageInput(agent_id="a1", event_id="x")
