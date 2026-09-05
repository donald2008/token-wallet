"""reporter 单测: 提取映射 / buffer / 判重护栏 / 失败重发。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from reporter import Reporter, canonical_tokens, kind_from_platform  # noqa: E402


# ── canonical_tokens 字段映射 ────────────────────────────────────────────────
def test_canonical_mapping():
    u = {
        "input_tokens": 1200, "output_tokens": 800, "reasoning_tokens": 45,
        "cache_read_tokens": 15230, "cache_write_tokens": 0, "request_count": 1,
    }
    r = canonical_tokens(u)
    assert r["input_cache_hit"]["tokens"] == 15230
    assert r["input_cache_miss"]["tokens"] == 1200
    assert r["output"]["tokens"] == 845  # 800 + 45 reasoning 并入
    assert r["total"] == {"cost": None, "currency": None}
    assert all(m["cost"] is None for k, m in r.items() if k != "total")


def test_canonical_empty():
    assert canonical_tokens({}) is None
    assert canonical_tokens(None) is None  # type: ignore[arg-type]


# ── kind 粗分 ────────────────────────────────────────────────────────────────
def test_kind_mapping():
    assert kind_from_platform("webhook") == "coding"
    assert kind_from_platform("cli") == "chat"
    assert kind_from_platform("cron") == "cron"
    assert kind_from_platform("weird-thing") == "other"
    assert kind_from_platform("") == "other"


# ── unknown 占位护栏 ─────────────────────────────────────────────────────────
def test_unknown_guard_dedup():
    r = Reporter()
    r.maybe_unknown("s1", "t1", "m", "p", "cli", 1000.0)
    n1 = len(r._buffer)
    r.maybe_unknown("s1", "t1", "m", "p", "cli", 1001.0)  # 同 (session,turn) → 不重复
    assert n1 == len(r._buffer) == 1
    assert r._buffer[0]["status"] == "unknown"
    assert r._buffer[0]["usage"] is None
    r.maybe_unknown("s1", "t2", "m", "p", "cli", 1002.0)  # 不同 turn → 新记录
    assert len(r._buffer) == 2


def test_mark_completed_blocks_unknown():
    r = Reporter()
    r.mark_completed("s1", "t1")
    r.maybe_unknown("s1", "t1", "m", "p", "cli", 1000.0)  # completed 已报 → unknown 不补
    assert len(r._buffer) == 0


# ── buffer flush ────────────────────────────────────────────────────────────
def test_flush_posts_and_clears(monkeypatch):
    r = Reporter()
    posted = []
    monkeypatch.setattr(r, "_post", lambda batch: posted.extend(batch))
    r.enqueue({"schema_version": 1, "event_id": "e1"})
    r._flush_once()
    assert len(posted) == 1 and r._buffer == []


def test_requeue_on_failure(monkeypatch):
    r = Reporter()

    def boom(batch):
        raise ConnectionError("daemon down")

    monkeypatch.setattr(r, "_post", boom)
    r.enqueue({"schema_version": 1, "event_id": "e1"})
    r._flush_once()
    assert len(r._buffer) == 1  # 回队


def test_requeue_drops_after_timeout(monkeypatch):
    import reporter as mod

    r = Reporter()
    r._last_ok = 0.0  # 模拟长期不可达
    mod.UNREACHABLE_DROP_MIN = 30
    monkeypatch.setattr("time.time", lambda: 100_000_000.0)
    batch = [{"schema_version": 1, "event_id": "old"}]
    r._requeue(batch)
    assert r._buffer == []  # 超时丢弃
