"""schema 校验测试 — pydantic 对照 spec §1.1 + 5 组 fixture accept/reject 结论。"""
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fixtures import ALL_FIXTURES  # noqa: E402
from mcp_server.schema import (  # noqa: E402
    ReportUsageInput,
    UsageReport,
    extract_event_id,
    format_validation_error,
)


def validate_envelope(payload):
    return ReportUsageInput.model_validate(payload)


class TestFixtures:
    """5 组正反例: accept/reject 结论必须与 spec §8 期望一致。"""

    def test_F1_completed_accepted(self):
        env = validate_envelope(ALL_FIXTURES["F1"])
        assert len(env.reports) == 1
        assert env.reports[0].status == "completed"

    def test_F2_partial_accepted(self):
        env = validate_envelope(ALL_FIXTURES["F2"])
        assert env.reports[0].status == "partial"

    def test_F3_unknown_usage_null_accepted(self):
        env = validate_envelope(ALL_FIXTURES["F3"])
        r = env.reports[0]
        assert r.status == "unknown"
        assert r.usage is None
        assert r.model == "" and r.provider == ""  # unknown 允许空串

    def test_F4_and_F4b_schema_valid(self):
        # F4/F4b schema 层合法, 判重在存储层测 (见 test_storage.py)
        validate_envelope(ALL_FIXTURES["F4"])
        validate_envelope(ALL_FIXTURES["F4b"])

    def test_F5_rejects_two_accepts_one(self):
        """F5: index0 (status 枚举违例+tokens 负数) 与 index1 (event_id pattern) 必须逐条拒。"""
        reports = ALL_FIXTURES["F5"]["reports"]
        assert _reject_reason(reports[0]) is not None
        assert _reject_reason(reports[1]) is not None
        assert validate_envelope({"reports": [reports[2]]}) is not None

    def test_F5_error_details(self):
        reports = ALL_FIXTURES["F5"]["reports"]
        r0 = _reject_reason(reports[0])
        assert "status" in r0  # status 枚举违例
        assert "tokens" in r0  # tokens 负数
        r1 = _reject_reason(reports[1])
        assert "event_id" in r1  # pattern 违例


def _reject_reason(item) -> str | None:
    """逐条校验, 违例返回错误明细, 合法返回 None (对应 rejected[].error 提取路径)。"""
    try:
        UsageReport.model_validate(item)
        return None
    except ValidationError as e:
        return format_validation_error(e)


F6 = {
    "reports": [{
        "schema_version": 1,
        "event_id": "01912345-6789-7abc-8def-0123456789b0",
        "status": "completed",
        "agent_id": "njbx02",
        "harness": "hermes",
        "session_id": None,
        "ts": "2026-09-06T03:00:00+08:00",
        "model": "glm-5.3-flash",
        "provider": "zai",
        "usage": None,
        "context": {"kanban_task": None, "kind": "other"},
    }]
}


class TestF6CrossGuard:
    """F6 (spec §8): completed + usage:null → rejected, error 说明交叉约束违例。"""

    def test_f6_rejected(self):
        item = F6["reports"][0]
        err = _reject_reason(item)
        assert err is not None
        assert "usage" in err.lower()

    def test_f6_via_report_usage(self, tmp_path):
        from mcp_server.storage import EventStorage
        from mcp_server.tools_report import report_usage

        storage = EventStorage(tmp_path / "f6.db")
        out = report_usage(F6, storage)
        assert out["accepted"] == 0 and out["duplicated"] == 0
        assert len(out["rejected"]) == 1
        assert out["rejected"][0]["index"] == 0
        assert out["rejected"][0]["event_id"] == "01912345-6789-7abc-8def-0123456789b0"


class TestSchemaEdges:
    def test_reject_unknown_status(self):
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0], status="ok")
        assert "status" in _reject_reason(item)

    def test_reject_negative_tokens(self):
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0],
                       **{"usage.input_cache_hit.tokens": -5})
        assert "tokens" in _reject_reason(item)

    def test_reject_bad_event_id(self):
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0], event_id="not-a-uuid")
        assert "event_id" in _reject_reason(item)

    def test_reject_uuidv4_shape(self):
        """非 v7 (第3组第4位非 7) 必须拒。"""
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0],
                       event_id="01912345-6789-4abc-8def-0123456789ab")
        assert "event_id" in _reject_reason(item)

    def test_reject_uuid_v7_wrong_variant(self):
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0],
                       event_id="01912345-6789-7abc-cdef-0123456789ab")
        assert "event_id" in _reject_reason(item)

    def test_reject_completed_with_null_usage(self):
        """交叉校验 (终审 P2 #2 硬性要求): completed + usage:null → reject。"""
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0], usage=None)
        err = _reject_reason(item)
        assert err is not None and "usage" in err.lower()

    def test_reject_partial_with_null_usage(self):
        item = _mutate(ALL_FIXTURES["F2"]["reports"][0], usage=None)
        assert _reject_reason(item) is not None

    def test_unknown_with_null_usage_ok(self):
        item = _mutate(ALL_FIXTURES["F3"]["reports"][0], usage=None)
        assert UsageReport.model_validate(item) is not None

    def test_reject_missing_required(self):
        item = {k: v for k, v in ALL_FIXTURES["F1"]["reports"][0].items() if k != "agent_id"}
        assert "agent_id" in _reject_reason(item)

    def test_reject_extra_property(self):
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0], maxItems=100)
        assert _reject_reason(item) is not None

    def test_reject_total_with_tokens(self):
        """total 是 cost_only — 带 tokens 拒。"""
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0], **{"usage.total.tokens": 5})
        assert "total" in _reject_reason(item)

    def test_envelope_empty_rejected(self):
        with pytest.raises(ValidationError):
            validate_envelope({"reports": []})

    def test_envelope_over_100_rejected(self):
        base = ALL_FIXTURES["F1"]["reports"][0]
        reports = []
        for i in range(101):
            r = _mutate(base, event_id=f"01912345-6789-7abc-8def-{i:012x}")
            reports.append(r)
        with pytest.raises(ValidationError):
            validate_envelope({"reports": reports})

    def test_envelope_rejects_maxitems_key(self):
        """spec §1.1 警示: maxItems 是约束不是传输字段。"""
        with pytest.raises(ValidationError):
            validate_envelope({"reports": ALL_FIXTURES["F1"]["reports"], "maxItems": 100})

    def test_envelope_not_array(self):
        with pytest.raises(ValidationError):
            validate_envelope({"reports": "nope"})

    def test_reject_ts_without_timezone(self):
        item = _mutate(ALL_FIXTURES["F1"]["reports"][0], ts="2026-09-06T01:49:30")
        assert "ts" in _reject_reason(item)

    def test_extract_event_id(self):
        assert extract_event_id({"event_id": "x"}) == "x"
        assert extract_event_id({"event_id": 5}) is None
        assert extract_event_id("nope") is None


def _mutate(item: dict, **overrides) -> dict:
    import copy

    out = copy.deepcopy(item)
    for k, v in overrides.items():
        if "." in k:
            a, b = k.split(".", 1)
            out[a][b] = v
        else:
            out[k] = v
    return out
