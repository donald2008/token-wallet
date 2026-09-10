"""daemon 入口 — 端口 9131, streamable-http, 端点 /mcp (spec §2/§5)。

配置 (独立产品形态): mcp.env (~/.config/token-wallet/mcp.env, app 生成管理,
daemon 读取) + 进程 env 覆盖 + 代码缺省, 见 config.py:
  TOKEN_WALLET_MCP_KEY  必填; 不豁免 loopback
  TOKEN_WALLET_DB_PATH  缺省 ~/.local/share/token-wallet/token-wallet.db
  TOKEN_WALLET_PORT     缺省 9131
  TOKEN_WALLET_HOST     缺省 127.0.0.1 (独立产品本机优先)
  USAGE_TTL_DAYS        缺省 90 (§4.3)
引导接口: MCP 工具 get_onboarding_guide / HTTP GET /guide (JSON+HTML 双视图)。
"""
from __future__ import annotations

import sys
import threading

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from . import onboarding
from .auth import BearerAuthMiddleware
from .config import DEFAULT_HOST, DEFAULT_PORT, resolve_config
from .storage import EventStorage
from .tools_query import EchoEngine, SummaryEngine
from .tools_report import report_usage as report_usage_impl


def build_server(
    *,
    db_path: str,
    ttl_days: int,
    endpoint: str = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/mcp",
) -> FastMCP:
    storage = EventStorage(db_path)
    summary_engine = SummaryEngine(storage.conn, lock=storage._lock)
    echo_engine = EchoEngine(storage)

    mcp = FastMCP(
        "token-wallet-mcp",
        instructions=(
            "token-wallet usage data-plane (D-055). report_usage=写, "
            "usage_summary=读聚合, usage_report_echo=读原文。协议权威源: docs/mcp-protocol.md"
        ),
    )

    @mcp.tool(name="report_usage")  # 工具名照 spec §2.1 (终审复验 P2 #1: 禁用实现别名)
    def report_usage(reports: list[dict]) -> dict:
        """批量上报 Agent LLM 用量 (1-100 条 AgentUsageReport v1)。

        input = spec §2.1 批量信封: 参数平铺为 reports 数组 — 客户端直接发
        {"reports": [...]} (三层二审 P1: 禁 payload 嵌套包装)。
        event_id 幂等: 重试/重发复用同一 event_id, 命中判重返回 duplicated
        (不是错误); schema 违例进 rejected 逐条明细, 部分失败不回滚。
        """
        return report_usage_impl({"reports": reports}, storage)

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

    @mcp.tool
    def get_onboarding_guide() -> dict:
        """agent 接入引导 (唯一入口): 返回 endpoint + server_version + agents 列表。

        agents 每条 = {id, name, plugin_url, docs_url, configure, verify};
        plugin_url/docs_url 可为 null (待适配器实现后补)。
        HTTP 同源视图: GET /guide (Accept: application/json | text/html)。
        """
        return onboarding.onboarding_guide(endpoint)

    # TTL 维护: 后台线程每日 03:37 本地时区执行 (先聚合后删, §4.3)
    from . import maintenance

    def _run_maintenance() -> dict:
        with storage._lock:
            storage.ensure_usage_records_table()
        return maintenance.daily_maintenance(storage.conn, ttl_days, _lock=storage._lock)

    def _maintenance_loop() -> None:
        import time
        from datetime import datetime, timedelta

        from .tzutil import local_tz

        # 时区统一走 tzutil (§4.3, 三层二审 P3): TOKEN_WALLET_TZ 可覆盖宿主
        tz, _ = local_tz()
        while True:
            now = datetime.now(tz)
            # 下次执行 = 今天 03:37 若未过, 否则明日 03:37
            # (三层二审 P3: 恒取明日会跳过当日维护 — 当日启动已过点才顺延)
            nxt = now.replace(hour=3, minute=37, second=0, microsecond=0)
            if nxt <= now:
                nxt += timedelta(days=1)
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


# ---------------------------------------------------------------- /guide ----

def _render_guide_html(guide: dict) -> str:
    """同一数据源的简单 HTML 步骤页 (浏览器人看), 不引前端框架。"""
    agents_html: list[str] = []
    for a in guide["agents"]:
        plugin = (
            f'<a href="{a["plugin_url"]}">{a["plugin_url"]}</a>'
            if a["plugin_url"]
            else "<em>null</em>"
        )
        docs = (
            f'<a href="{a["docs_url"]}">{a["docs_url"]}</a>'
            if a["docs_url"]
            else "<em>null</em>"
        )
        agents_html.append(
            "<tr>"
            f'<td>{a["id"]}</td>'
            f'<td>{a["name"]}</td>'
            f"<td>{plugin}</td>"
            f"<td>{docs}</td>"
            f"<td>{a['configure']}</td>"
            f"<td>{a['verify']}</td>"
            "</tr>"
        )
    return f"""<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>token-wallet MCP — agent 接入引导</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 2rem; color: #222; }}
code, .endpoint {{ background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }}
.endpoint {{ font-size: 1.1em; }}
table {{ border-collapse: collapse; margin-top: 1rem; width: 100%; }}
th, td {{ border: 1px solid #ddd; padding: 6px 10px; text-align: left; vertical-align: top; }}
th {{ background: #f8f8f8; }}
</style>
</head>
<body>
<h1>token-wallet MCP — agent 接入引导</h1>
<p>endpoint: <span class="endpoint">{guide["endpoint"]}</span></p>
<p>server_version: <code>{guide["server_version"]}</code></p>
<h2>接入步骤</h2>
<ol>
<li>从 mcp.env (~/.config/token-wallet/mcp.env) 取 TOKEN_WALLET_MCP_KEY</li>
<li>按下方对应 agent 行的 configure 说明配置 endpoint + key</li>
<li>按 verify 说明验证上报是否收到 (MCP 工具 <code>usage_summary</code>)</li>
</ol>
<h2>agents</h2>
<table>
<tr><th>id</th><th>name</th><th>plugin_url</th><th>docs_url</th><th>configure</th><th>verify</th></tr>
{''.join(agents_html)}
</table>
</body>
</html>"""


def _display_host(host: str) -> str:
    """通配 bind(0.0.0.0/::)不是可访问地址 — /guide 展示时解析局域网 IPv4 (t_da2fd1f1 U6)。

    app 侧 mcp-ipc/mcp-address 已同款处理(daemon 侧兜底: 直连 /guide 的场景)。
    """
    if host.strip("[]").lower() not in ("0.0.0.0", "::", "0:0:0:0:0:0:0:0"):
        return host
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # 不实际发包, 仅取路由源地址
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


async def guide_endpoint(request: Request) -> Response:
    """GET /guide — 与 get_onboarding_guide 工具同一数据源。

    Accept: text/html → HTML 步骤页; 其余 (application/json) → JSON。
    """
    endpoint = (
        f"http://{_display_host(request.app.state.guide_host)}:"
        f"{request.app.state.guide_port}/mcp"
    )
    guide = onboarding.onboarding_guide(endpoint)
    if "text/html" in request.headers.get("accept", ""):
        return HTMLResponse(_render_guide_html(guide))
    return JSONResponse(guide)


def build_http_app(
    *, key: str, host: str, port: int, db_path: str, ttl_days: int
):
    """http_app + /guide 路由 (guide 在 BearerAuth 中间件之外, 引导数据无密钥)。"""
    endpoint = f"http://{host}:{port}/mcp"
    mcp = build_server(db_path=db_path, ttl_days=ttl_days, endpoint=endpoint)
    app = mcp.http_app(
        path="/mcp",
        middleware=[Middleware(BearerAuthMiddleware, key=key)],
    )
    app.state.guide_host = host
    app.state.guide_port = port
    app.router.routes.append(
        Route("/guide", endpoint=guide_endpoint, methods=["GET"])
    )
    return app


def run_maintenance_once(*, db_path: str, ttl_days: int) -> dict:
    """CLI 手动触发维护 (验收用): python -c 'from mcp_server.__main__ import run_maintenance_once; ...'。"""
    storage = EventStorage(db_path)
    storage.ensure_usage_records_table()
    from . import maintenance

    return maintenance.daily_maintenance(storage.conn, ttl_days, _lock=storage._lock)


def main() -> None:
    cfg = resolve_config()
    key = str(cfg["key"])
    db_path = str(cfg["db_path"])
    ttl_days = int(cfg["ttl_days"])  # type: ignore[arg-type]
    host = str(cfg["host"])
    port = int(cfg["port"])  # type: ignore[arg-type]

    app = build_http_app(
        key=key, host=host, port=port, db_path=db_path, ttl_days=ttl_days
    )
    print(f"[token-wallet-mcp] serving on {host}:{port}/mcp, db={db_path}, ttl={ttl_days}d", flush=True)
    import uvicorn

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
