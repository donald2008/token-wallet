"""存储层测试: 两级判重 / 部分失败不回滚 / echo / fingerprint canonical。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import json  # noqa: E402

import pytest  # noqa: E402

from fixtures import ALL_FIXTURES  # noqa: E402
from mcp_server.schema import ReportUsageInput, UsageReport  # noqa: E402
from mcp_server.storage import EventStorage, compute_fingerprint  # noqa: E402
from mcp_server.tools_report import report_usage  # noqa: E402


@pytest.fixture()
def storage(tmp_path):
    return EventStorage(tmp_path / "test.db")


def _report(payload_item):
    return UsageReport.model_validate(payload_item)


class TestTwoLevelDedup:
    """两级判重 (spec §3): event_id PRIMARY KEY + fingerprint UNIQUE。"""

    def test_F1_then_F4_duplicate(self, storage):
        """F4 = F1 原文重发 → duplicated=1 (一级判重)。"""
        assert report_usage(ALL_FIXTURES["F1"], storage)["accepted"] == 1
        out = report_usage(ALL_FIXTURES["F4"], storage)
        assert out == {"accepted": 0, "duplicated": 1, "rejected": []}

    def test_F4b_content_fingerprint_duplicate(self, storage):
        """F4b = 内容同 F1 仅 event_id 不同 → fingerprint UNIQUE 命中 (二级判重)。"""
        assert report_usage(ALL_FIXTURES["F1"], storage)["accepted"] == 1
        out = report_usage(ALL_FIXTURES["F4b"], storage)
        assert out == {"accepted": 0, "duplicated": 1, "rejected": []}

    def test_same_batch_double_event_id(self, storage):
        """同批内重复 event_id: 第一条 accepted, 第二条 duplicated。"""
        payload = {"reports": [
            ALL_FIXTURES["F1"]["reports"][0],
            ALL_FIXTURES["F1"]["reports"][0],
        ]}
        out = report_usage(payload, storage)
        assert out["accepted"] == 1 and out["duplicated"] == 1

    def test_dedup_transparent_not_error(self, storage):
        """判重透明计数不报错 (§3), rejected 为空。"""
        report_usage(ALL_FIXTURES["F1"], storage)
        out = report_usage(ALL_FIXTURES["F4"], storage)
        assert out["rejected"] == []

    def test_fingerprint_spec_canonical(self):
        """fingerprint 按 §3 canonical 独立重算对照 (终审同款验证: F1 == F4b)。"""
        r1 = _report(ALL_FIXTURES["F1"]["reports"][0])
        r4b = _report(ALL_FIXTURES["F4b"]["reports"][0])
        fp1 = _fp(r1)
        fp4b = _fp(r4b)
        assert fp1 == fp4b  # 内容相同仅 event_id 不同 → 同 fingerprint
        r2 = _report(ALL_FIXTURES["F2"]["reports"][0])
        assert _fp(r2) != fp1

    def test_unknown_tokens_zero_in_fingerprint(self, storage):
        """unknown/usage=null 时三 tokens 取 0 (§3)。"""
        r3 = _report(ALL_FIXTURES["F3"]["reports"][0])
        expected = compute_fingerprint(
            session_id=None, ts_epoch=int(r3.ts_dt.timestamp()),
            model="", provider="", hit_tokens=0, miss_tokens=0, out_tokens=0,
            kind="other", status="unknown",
        )
        storage.insert_report(r3, expected)
        row = storage.conn.execute(
            "SELECT fingerprint FROM usage_events WHERE event_id=?",
            (r3.event_id,)).fetchone()
        assert row["fingerprint"] == expected


def _fp(r):
    usage = r.usage
    if usage is None:
        hit = miss = out = 0
    else:
        hit, miss, out = (usage.input_cache_hit.tokens,
                          usage.input_cache_miss.tokens, usage.output.tokens)
    return compute_fingerprint(
        session_id=r.session_id, ts_epoch=int(r.ts_dt.timestamp()),
        model=r.model, provider=r.provider,
        hit_tokens=hit, miss_tokens=miss, out_tokens=out,
        kind=r.context.kind, status=r.status,
    )


class TestPartialFailure:
    """§2.1 语义 3/4: 部分失败不回滚, 计数对账。"""

    def test_F5_independent_db(self, storage):
        """F5 全流程 (独立库前提, 终审 P2 #3): accepted=1 + 2 条 rejected 明细。"""
        out = report_usage(ALL_FIXTURES["F5"], storage)
        assert out["accepted"] == 1
        assert out["duplicated"] == 0
        assert len(out["rejected"]) == 2
        r0, r1 = out["rejected"]
        assert r0["index"] == 0
        assert r0["event_id"] == "01912345-6789-7abc-8def-0123456789af"
        assert "status" in r0["error"] and "tokens" in r0["error"]
        assert r1["index"] == 1
        assert r1["event_id"] == "not-a-uuid"
        assert "event_id" in r1["error"]
        # 第 3 条 (F1 原文) 照常落库
        n = storage.conn.execute("SELECT COUNT(*) c FROM usage_events").fetchone()["c"]
        assert n == 1

    def test_count_invariant(self, storage):
        """不变量: accepted + duplicated + rejected.length == reports.length。"""
        payload = {"reports": [
            ALL_FIXTURES["F1"]["reports"][0],
            ALL_FIXTURES["F5"]["reports"][0],   # 坏: status ok + 负 tokens
            ALL_FIXTURES["F5"]["reports"][1],   # 坏: not-a-uuid
            ALL_FIXTURES["F5"]["reports"][2],   # 好 (F1 原文, 同 event_id → duplicated)
        ]}
        out = report_usage(payload, storage)
        assert out["accepted"] + out["duplicated"] + len(out["rejected"]) == 4

    def test_raw_json_preserved(self, storage):
        """raw_json = 提交原文不变 (补算 cost 不改原文)。"""
        r1 = _report(ALL_FIXTURES["F1"]["reports"][0])
        storage.insert_report(r1, "fp-placeholder")
        row = storage.conn.execute(
            "SELECT raw_json FROM usage_events").fetchone()
        raw = json.loads(row["raw_json"])
        assert raw["usage"]["input_cache_hit"]["cost"] is None  # 原文 cost 仍 null
