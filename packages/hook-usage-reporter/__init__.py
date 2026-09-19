"""hook-usage-reporter 插件入口: 注册 post_api_request / on_stream_end / on_session_end hooks.

配置通道（2026-09-06 修正, loader 源码实锤）:
  env 优先 → 其次用户 config.yaml 的 ``plugins.entries.<plugin_id>.settings``
  （ctx.get_config 是 loader 消费的真实通道）。plugin.yaml 的 ``config:`` 块
  loader **不消费**（仅 config_schema 参与校验提示），故本插件不依赖它。

用法: 本目录拷入 ~/.hermes/plugins/hook_usage_reporter/, config.yaml
  plugins.entries.hook-usage-reporter.settings.enabled: true（或 env
  TOKEN_WALLET_REPORTER_ENABLED=true）。依赖: gateway venv 内 mcp/httpx2。
"""
from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("hook-usage-reporter")

_SRC = Path(__file__).parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from reporter import REPORTER, _iso, canonical_tokens, kind_from_platform, uuid7  # noqa: E402

_ENABLED = False  # register() 按配置置位; hook 回调运行时只读


def _apply_config(ctx: Any) -> bool:
    """读插件配置（env 优先 → plugins.entries.<id>.settings）落到 reporter 模块变量。

    数字键类型容错（YAML 里写成字符串数字不炸）; 返回 enabled 布尔。
    """
    import reporter as mod

    def _num(raw: Any, default: float) -> float:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    endpoint = os.getenv("TOKEN_WALLET_MCP_ENDPOINT") or ctx.get_config("endpoint") or mod.ENDPOINT
    key_env = str(ctx.get_config("key_env", "TOKEN_WALLET_MCP_KEY"))
    buffer_max = _num(os.getenv("TOKEN_WALLET_REPORTER_BUFFER_MAX") or ctx.get_config("buffer_max"), 50)
    flush_s = _num(os.getenv("TOKEN_WALLET_REPORTER_FLUSH_INTERVAL_S") or ctx.get_config("flush_interval_s"), 60.0)
    drop_min = _num(os.getenv("TOKEN_WALLET_REPORTER_DROP_MIN") or ctx.get_config("unreachable_drop_min"), 30.0)

    mod.ENDPOINT = str(endpoint)
    mod.KEY = os.getenv(key_env, "")
    mod.BUFFER_MAX = max(1, int(buffer_max))
    mod.FLUSH_INTERVAL_S = max(1.0, flush_s)
    mod.UNREACHABLE_DROP_MIN = max(1.0, drop_min)

    enabled: Any = os.getenv("TOKEN_WALLET_REPORTER_ENABLED")
    if enabled is None or enabled == "":
        enabled = ctx.get_config("enabled", False)
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() == "true"
    return bool(enabled)


def _on_post_api_request(**kwargs: Any) -> None:
    """每次真实 LLM API 调用成功后触发（usage 唯一来源, 0.21.0 实测）。"""
    if not _ENABLED:
        return
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
            "event_id": uuid7(),
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
    if not _ENABLED:
        return
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
    global _ENABLED
    try:
        enabled = _apply_config(ctx)
    except Exception:  # noqa: BLE001 — 配置失败用缺省值, 插件不拖垮 gateway
        logger.exception("config apply failed, falling back to defaults")
        enabled = os.getenv("TOKEN_WALLET_REPORTER_ENABLED", "false").lower() == "true"
    _ENABLED = enabled
    ctx.register_hook("post_api_request", _on_post_api_request)
    ctx.register_hook("on_stream_end", _on_stream_end)
    # 会话结束强制 flush（buffer 余量上报）; disabled 时 buffer 恒空, 无副作用
    ctx.register_hook("on_session_end", lambda **kw: REPORTER.flush_async())
    if enabled:
        REPORTER.start_timer()
    logger.info("usage-reporter registered (3 hooks), enabled=%s", enabled)
