"""hook-usage-reporter 插件入口: 注册 post_api_request / on_stream_end hooks.

用法: 本目录拷入 ~/.hermes/plugins/hook_usage_reporter/ , plugin.yaml enabled=true。
依赖: gateway venv 内 mcp/httpx2（harness 自带）。
"""
from __future__ import annotations

import logging
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger("hook-usage-reporter")

_SRC = Path(__file__).parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from reporter import REPORTER, _iso, canonical_tokens, kind_from_platform  # noqa: E402


def _on_post_api_request(**kwargs: Any) -> None:
    """每次真实 LLM API 调用成功后触发（usage 唯一来源, 0.21.0 实测）。"""
    try:
        u = kwargs.get("usage")
        tokens = canonical_tokens(u if isinstance(u, dict) else {})
        if tokens is None:
            return  # 无 usage → 不造数据
        ended_at = float(kwargs.get("ended_at") or 0) or time.time()
        session_id = kwargs.get("session_id") or ""
        turn_id = kwargs.get("turn_id") or ""
        report = {
            "schema_version": 1,
            "event_id": str(uuid.uuid4()),
            "status": "completed",
            "agent_id": os.getenv("TOKEN_WALLET_REPORTER_AGENT_ID", "njbx02"),
            "harness": "hermes",
            "session_id": session_id or None,
            "ts": _iso(ended_at),
            "model": kwargs.get("model") or "",
            "provider": kwargs.get("provider") or "",
            "usage": tokens,
            "context": {"kanban_task": None, "kind": kind_from_platform(kwargs.get("platform"))},
        }
        REPORTER.mark_completed(session_id, turn_id)
        REPORTER.enqueue(report)
    except Exception:  # noqa: BLE001 — hook 绝不阻塞 agent 主链路
        logger.exception("post_api_request extract failed")


def _on_stream_end(**kwargs: Any) -> None:
    """流结束: finished=False = cancel/异常 → best-effort unknown 占位（护栏防双计）。"""
    try:
        if kwargs.get("finished"):
            return
        # stream_delivery._stream_hook_ctx: turn_id/session_id/model/provider/surface
        REPORTER.maybe_unknown(
            session_id=kwargs.get("session_id") or "",
            turn_id=kwargs.get("turn_id") or "",
            model=kwargs.get("model") or "",
            provider=kwargs.get("provider") or "",
            platform=kwargs.get("surface") or "",
            ended_at=time.time(),
        )
    except Exception:  # noqa: BLE001
        logger.exception("stream_end unknown fallback failed")


def register(ctx: Any) -> None:
    ctx.register_hook("post_api_request", _on_post_api_request)
    ctx.register_hook("on_stream_end", _on_stream_end)
    # 会话结束强制 flush（buffer 余量上报）
    ctx.register_hook("on_session_end", lambda **kw: REPORTER.flush_async())
    REPORTER.start_timer()
    enabled = os.getenv("TOKEN_WALLET_REPORTER_ENABLED", "false").lower() == "true"
    logger.info("usage-reporter registered (3 hooks), enabled=%s", enabled)
