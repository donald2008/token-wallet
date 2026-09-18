"""fixtures.json — spec §8 5 组共享测试向量 (F1-F5 + F4b 变体)。

权威源 docs/mcp-protocol.md; pydantic(daemon) 与 zod(hook) 两套实现的
accept/reject 结论必须一致 (spec §5)。
"""
from __future__ import annotations

import json
from pathlib import Path

F1 = {
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
            "input_cache_hit":  {"tokens": 15230, "cost": None, "currency": None},
            "input_cache_miss": {"tokens": 1200,  "cost": None, "currency": None},
            "output":           {"tokens": 845,   "cost": None, "currency": None},
            "total":            {"cost": None, "currency": None},
        },
        "context": {"kanban_task": "t_586ae6ac", "kind": "coding"},
    }]
}

F2 = {
    "reports": [{
        "schema_version": 1,
        "event_id": "01912345-6789-7abc-8def-0123456789ac",
        "status": "partial",
        "agent_id": "njbx02",
        "harness": "hermes",
        "session_id": "20260906_020000_aaa111",
        "ts": "2026-09-06T02:00:10+08:00",
        "model": "glm-5.3-flash",
        "provider": "zai",
        "usage": {
            "input_cache_hit":  {"tokens": 9000, "cost": None, "currency": None},
            "input_cache_miss": {"tokens": 500,  "cost": None, "currency": None},
            "output":           {"tokens": 210,  "cost": None, "currency": None},
            "total":            {"cost": None, "currency": None},
        },
        "context": {"kanban_task": None, "kind": "chat"},
    }]
}

F3 = {
    "reports": [{
        "schema_version": 1,
        "event_id": "01912345-6789-7abc-8def-0123456789ad",
        "status": "unknown",
        "agent_id": "desktop-e5jupfs",
        "harness": "opencode",
        "session_id": None,
        "ts": "2026-09-06T02:05:00+08:00",
        "model": "",
        "provider": "",
        "usage": None,
        "context": {"kanban_task": None, "kind": "other"},
    }]
}

# F4 = F1 原文重发 (一级判重); F4b = 内容同 F1 仅 event_id 不同 (二级判重)
F4 = json.loads(json.dumps(F1))
F4["reports"][0]["event_id"] = F1["reports"][0]["event_id"]

F4B = json.loads(json.dumps(F1))
F4B["reports"][0]["event_id"] = "01912345-6789-7abc-8def-0123456789ae"

# F5 坏 schema: 3 条 = [status 枚举违例+tokens 负数, event_id pattern 违例, F1 原文]
F5 = {
    "reports": [
        {"schema_version": 1, "event_id": "01912345-6789-7abc-8def-0123456789af",
         "status": "ok",
         "agent_id": "njbx02", "harness": "hermes", "session_id": None,
         "ts": "2026-09-06T02:10:00+08:00", "model": "glm-5.3-flash", "provider": "zai",
         "usage": {"input_cache_hit": {"tokens": -5, "cost": None, "currency": None},
                   "input_cache_miss": {"tokens": 0, "cost": None, "currency": None},
                   "output": {"tokens": 0, "cost": None, "currency": None},
                   "total": {"cost": None, "currency": None}},
         "context": {"kanban_task": None, "kind": "chat"}},
        {"schema_version": 1, "event_id": "not-a-uuid",
         "status": "completed", "agent_id": "njbx02", "harness": "hermes",
         "session_id": None, "ts": "2026-09-06T02:10:01+08:00",
         "model": "glm-5.3-flash", "provider": "zai",
         "usage": {"input_cache_hit": {"tokens": 1, "cost": None, "currency": None},
                   "input_cache_miss": {"tokens": 0, "cost": None, "currency": None},
                   "output": {"tokens": 0, "cost": None, "currency": None},
                   "total": {"cost": None, "currency": None}},
         "context": {"kanban_task": None, "kind": "chat"}},
        # 注: 独立库前提下 (终审 P2 #3), 第 3 条 F1 原文照常落库 → accepted=1
        json.loads(json.dumps(F1["reports"][0])),
    ]
}

ALL_FIXTURES = {"F1": F1, "F2": F2, "F3": F3, "F4": F4, "F4b": F4B, "F5": F5}


def dump_all(target: Path) -> None:
    target.write_text(json.dumps(ALL_FIXTURES, ensure_ascii=False, indent=2), encoding="utf-8")
