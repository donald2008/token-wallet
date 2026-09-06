"""daemon 入口 — 端口 9131, streamable-http, 端点 /mcp (spec §2/§5)。

env 配置:
  TOKEN_WALLET_MCP_KEY  必填, Bearer 一把 key (Consul 注入); 不豁免 loopback
  TOKEN_WALLET_DB_PATH  缺省 <dataDir>/token-wallet.db (dataDir 缺省 ~/.local/share/token-wallet)
  TOKEN_WALLET_PORT     缺省 9131
  TOKEN_WALLET_HOST     缺省 0.0.0.0
  USAGE_TTL_DAYS        缺省 90 (§4.3)
"""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

from fastmcp import FastMCP
from starlette.middleware import Middleware

from .auth import BearerAuthMiddleware
from .storage import EventStorage
from .tools_query import EchoEngine, SummaryEngine
from .tools_report import report_usage


def _data_dir() -> Path:
    if xdg := os.environ.get("XDG_DATA_HOME"):
        return Path(xdg) / "token-wallet"
    return Path.home() / ".local" / "share" / "token-wallet"


def build_server(*, db_path: str, ttl_days: int) -> FastMCP:
    storage = EventStorage(db_path)
    summary_engine = SummaryEngine(storage.conn, lock=storage._lock)
    echo_engine = EchoEngine(storage)

    mcp = FastMCP(
        "token-wallet-mcp",
        instructions=(
            "token-wallet usage data-plane (D-048). report_usage=写, "
            "usage_summary=读聚合, usage_report_echo=读原文。协议权威源: docs/mcp-protocol.md"
        ),
    )

    @mcp.tool(name="report_usage")  # 工具名照 spec §2.1 (终审复验 P2 #1: 禁用实现别名)
    def report_usage_tool(payload: dict) -> dict:
        """批量上报 Agent LLM 用量 (1-100 条 AgentUsageReport v1)。

        payload = {"reports": [...]}。event_id 幂等: 重试/重发复用同一 event_id,
        命中判重返回 duplicated (不是错误); schema 违例进 rejected 逐条明细,
        部分失败不回滚。
        """
        return report_usage(payload, storage)

    @mcp.tool
    def usage_summary(
        since: str | None = None,
        until: str | None = None,
        agent_id: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        kanban_task: str | None = None,
        group_by: list[str] | None = None,
    ) -> dict:
        """读聚合: 按窗口/维度分组出 rows+total。

        group_by ⊆ {agent,provider,model,day,status} ≤3 维, 缺省 ["agent"]。
        unknown 状态不计 tokens 只计 calls; 混币种分行, total 混币种时为 null。
        """
        from .schema import UsageSummaryInput

        q = UsageSummaryInput(
            since=since,
            until=until,
            agent_id=agent_id,
            provider=provider,
            model=model,
            kanban_task=kanban_task,
            group_by=group_by or ["agent"],
        )
        return summary_engine.summary(q).model_dump()

    @mcp.tool
    def usage_report_echo(
        event_id: str | None = None,
        session_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 50,
    ) -> dict:
        """读原文: 按 event_id / session_id / 时间段回读落库原文 (raw_json)。

        event_id 与 session_id 互斥; limit 1-500 缺省 50; total_count 不受 limit 影响。
        """
        from .schema import UsageReportEchoInput

        q = UsageReportEchoInput(
            event_id=event_id,
            session_id=session_id,
            since=since,
            until=until,
            limit=limit,
        )
        return echo_engine.echo(q).model_dump()

    # TTL 维护: 后台线程每日 03:37 本地时区执行 (先聚合后删, §4.3)
    from . import maintenance

    def _run_maintenance() -> dict:
        with storage._lock:
            storage.ensure_usage_records_table()
        return maintenance.daily_maintenance(storage.conn, ttl_days, _lock=storage._lock)

    def _maintenance_loop() -> None:
        import time
        from datetime import datetime, timedelta

        while True:
            now = datetime.now().astimezone()
            nxt = (now + timedelta(days=1)).replace(hour=3, minute=37, second=0, microsecond=0)
            time.sleep(max(0.0, (nxt - now).total_seconds()))
            try:
                result = _run_maintenance()
                print(f"[token-wallet-mcp] maintenance: {result}", flush=True)
            except Exception as e:  # 维护失败不杀 daemon, 次日重试
                print(f"[token-wallet-mcp] maintenance failed: {e}", file=sys.stderr, flush=True)

    threading.Thread(target=_maintenance_loop, name="ttl-maintenance", daemon=True).start()

    # 手动触发入口 (验收/运维用): 不挂 @mcp.tool —— 不出现在 agent 数据面
    # tools/list (终审复验 P2 #2)。需触发时走 systemd exec 或 python -c 调 maintenance。
    build_server._run_maintenance = _run_maintenance  # type: ignore[attr-defined]

    return mcp


def run_maintenance_once(*, db_path: str, ttl_days: int) -> dict:
    """CLI 手动触发维护 (验收用): python -c 'from mcp_server.__main__ import run_maintenance_once; ...'。"""
    storage = EventStorage(db_path)
    storage.ensure_usage_records_table()
    from . import maintenance

    return maintenance.daily_maintenance(storage.conn, ttl_days, _lock=storage._lock)


def main() -> None:
    key = os.environ.get("TOKEN_WALLET_MCP_KEY")
    if not key:
        print(
            "fatal: TOKEN_WALLET_MCP_KEY not set (Consul ai-hermes/security/providers/token-wallet-mcp-key)",
            file=sys.stderr,
        )
        sys.exit(1)

    db_path = os.environ.get("TOKEN_WALLET_DB_PATH") or str(_data_dir() / "token-wallet.db")
    ttl_days = int(os.environ.get("USAGE_TTL_DAYS", "90"))
    host = os.environ.get("TOKEN_WALLET_HOST", "0.0.0.0")
    port = int(os.environ.get("TOKEN_WALLET_PORT", "9131"))

    mcp = build_server(db_path=db_path, ttl_days=ttl_days)
    app = mcp.http_app(
        path="/mcp",
        middleware=[Middleware(BearerAuthMiddleware, key=key)],
    )
    print(f"[token-wallet-mcp] serving on {host}:{port}/mcp, db={db_path}, ttl={ttl_days}d", flush=True)
    import uvicorn

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
