"""Reporter 核心: 提取 → buffer → 异步 flush → MCP report_usage.

零阻塞保证: hook 回调只做提取+入队(内存 dict 操作), 网络在后台线程。
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("hook-usage-reporter")

# ── 配置缺省值(register 时可被 env / plugins.entries.<id>.settings 覆盖) ──────
ENDPOINT = os.getenv("TOKEN_WALLET_MCP_ENDPOINT", "http://127.0.0.1:9131/mcp")
KEY = os.getenv("TOKEN_WALLET_MCP_KEY", "")
BUFFER_MAX = int(os.getenv("TOKEN_WALLET_REPORTER_BUFFER_MAX", "50"))
FLUSH_INTERVAL_S = float(os.getenv("TOKEN_WALLET_REPORTER_FLUSH_INTERVAL_S", "60"))
UNREACHABLE_DROP_MIN = float(os.getenv("TOKEN_WALLET_REPORTER_DROP_MIN", "30"))

# usage-reporter 上报自身的 agent_id: gateway 所在机 = njbx02
AGENT_ID = os.getenv("TOKEN_WALLET_REPORTER_AGENT_ID", "njbx02")
HARNESS = "hermes"


def _iso(epoch: float) -> str:
    """epoch 秒 → ISO8601 带时区(njbx02 = +08:00)。"""
    return datetime.fromtimestamp(epoch, tz=timezone.utc).astimezone().isoformat(timespec="milliseconds")


def uuid7() -> str:
    """RFC 9562 UUIDv7（stdlib 3.11 无内置）：48bit ms 时间戳 + 74bit 随机。

    spec §1.1 event_id pattern 要求版本位字面量 '7'——uuid4 会被 daemon 判
    pattern 违例整条 rejected。monotonic 同毫秒不保证，协议无此要求。
    """
    ms = time.time_ns() // 1_000_000
    rand_a = os.urandom(2)   # 12 bits (version 后的 rand_a)
    rand_b = os.urandom(8)   # 62 bits (variant 占高 2 位)
    b = bytearray(16)
    b[0:6] = ms.to_bytes(6, "big")
    b[6] = 0x70 | (rand_a[0] >> 4)                       # version 7
    b[7] = ((rand_a[0] & 0x0F) << 4) | (rand_a[1] >> 4)
    b[8] = 0x80 | (rand_b[0] & 0x3F)                     # variant 10xx
    b[9:16] = rand_b[1:8]
    h = b.hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def canonical_tokens(u: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """CanonicalUsage dict → AgentUsageReport usage 四分项。无 usage 返回 None。"""
    if not u:
        return None
    try:
        hit = int(u.get("cache_read_tokens", 0) or 0)
        miss = int(u.get("input_tokens", 0) or 0)
        # reasoning 计费归 output
        out = int(u.get("output_tokens", 0) or 0) + int(u.get("reasoning_tokens", 0) or 0)
        return {
            "input_cache_hit": {"tokens": hit, "cost": None, "currency": None},
            "input_cache_miss": {"tokens": miss, "cost": None, "currency": None},
            "output": {"tokens": out, "cost": None, "currency": None},
            "total": {"cost": None, "currency": None},
        }
    except Exception:  # noqa: BLE001 — 提取失败不阻塞 agent
        return None


def kind_from_platform(platform: str) -> str:
    """session 来源粗分 kind。判不准缺省 other（宁缺不错）。"""
    p = (platform or "").lower()
    if p in ("webhook", "kanban"):
        return "coding"
    if p in ("cli", "desktop", "tui"):
        return "chat"
    if p == "cron":
        return "cron"
    return "other"


def raise_if_envelope_error(result: Any) -> None:
    """MCP 信封级 tool error(空批/超100条/顶层多字段)以 is_error 文本返回不抛异常;
    不检查会被当成功 → 整批静默丢失(违反 spec §2.1 语义6 整批重发)。

    真模型字段 = CallToolResult.is_error (mcp pydantic v2 实测);
    兼容 stub 的 isError 形态。两者都缺席视为 False。
    """
    is_err = getattr(result, "is_error", None)
    if is_err is None:
        is_err = getattr(result, "isError", False)
    if is_err:
        text = "".join(getattr(c, "text", "") for c in (getattr(result, "content", None) or []))
        raise RuntimeError(f"report_usage envelope error: {text[:500]}")


class Reporter:
    """内存 buffer + 后台 flush 线程 + MCP streamable-http 上报。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._spawn_lock = threading.Lock()  # flush 线程 spawn 原子性(timer/session_end 并发)
        self._buffer: List[Dict[str, Any]] = []
        self._reported_keys: set = set()  # (session_id, turn_id) 防双计护栏
        self._last_ok: float = time.time()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ── hook 侧(零阻塞) ────────────────────────────────────────────────
    def enqueue(self, report: Dict[str, Any]) -> None:
        with self._lock:
            self._buffer.append(report)
            size = len(self._buffer)
        if size >= BUFFER_MAX:
            self.flush_async()

    def maybe_unknown(self, session_id: str, turn_id: str, model: str, provider: str,
                      platform: str, ended_at: float) -> None:
        """on_stream_end(finished=False) 时补 unknown 占位; (session,turn) 已报过则跳过。"""
        key = (session_id, turn_id)
        with self._lock:
            if key in self._reported_keys:
                return
            self._reported_keys.add(key)
        self.enqueue({
            "schema_version": 1,
            "event_id": uuid7(),
            "status": "unknown",
            "agent_id": AGENT_ID,
            "harness": HARNESS,
            "session_id": session_id or None,
            "ts": _iso(ended_at),
            "model": model or "",
            "provider": provider or "",
            "usage": None,
            "context": {"kanban_task": None, "kind": kind_from_platform(platform)},
        })

    def mark_completed(self, session_id: str, turn_id: str) -> None:
        with self._lock:
            self._reported_keys.add((session_id, turn_id))
        # 护栏集合防膨胀: 超 1 万条截半(保守清理, 误清率极低)
        if len(self._reported_keys) > 10_000:
            ks = list(self._reported_keys)
            self._reported_keys = set(ks[len(ks) // 2:])

    # ── flush(后台线程) ────────────────────────────────────────────────
    def flush_async(self) -> None:
        with self._spawn_lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._flush_once, daemon=True,
                                            name="usage-reporter-flush")
            self._thread.start()

    def _flush_once(self) -> None:
        with self._lock:
            batch = self._buffer[:]
            self._buffer = []
        if not batch:
            return
        try:
            self._post(batch)
            self._last_ok = time.time()
        except Exception as exc:  # noqa: BLE001
            logger.warning("report_usage flush failed (%s), %d 条回队", exc, len(batch))
            self._requeue(batch)

    def _requeue(self, batch: List[Dict[str, Any]]) -> None:
        """断线排队: 回队首(FIFO 补发); 不可达超阈值丢批防 OOM。"""
        if time.time() - self._last_ok > UNREACHABLE_DROP_MIN * 60:
            logger.warning("daemon unreachable >%.0fmin, drop %d 条", UNREACHABLE_DROP_MIN, len(batch))
            return
        with self._lock:
            self._buffer = batch + self._buffer

    def _post(self, batch: List[Dict[str, Any]]) -> None:
        """MCP tools/call(report_usage)。用官方 mcp 包 streamable-http client。"""
        import asyncio

        asyncio.run(self._post_async(batch))

    async def _post_async(self, batch: List[Dict[str, Any]]) -> None:
        import httpx2
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client

        headers = {"Authorization": f"Bearer {KEY}"} if KEY else {}
        async with httpx2.AsyncClient(headers=headers, timeout=30) as http:
            async with streamable_http_client(ENDPOINT, http_client=http) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool("report_usage", {"reports": batch})
                    raise_if_envelope_error(result)
                    text = "".join(getattr(c, "text", "") for c in (result.content or []))
                    logger.info("report_usage ok: %s", text[:200])

    # ── 生命周期 ────────────────────────────────────────────────────────
    def start_timer(self) -> None:
        def _loop() -> None:
            while not self._stop.wait(FLUSH_INTERVAL_S):
                if self._buffer:
                    self.flush_async()

        threading.Thread(target=_loop, daemon=True, name="usage-reporter-timer").start()

    def stop(self) -> None:
        self._stop.set()
        if self._buffer:
            self.flush_async()


REPORTER = Reporter()
