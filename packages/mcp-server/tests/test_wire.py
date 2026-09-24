"""wire 格式测试 (三层二审 P1): report_usage 参数平铺 = spec §2.1 批量信封。

工具 inputSchema 必须直接是 {"reports": [...]} — required=["reports"],
properties 里没有 payload 包装层。hook 照 spec 发送即被 fastmcp 参数校验命中。
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import asyncio  # noqa: E402


def _build():
    from mcp_server.__main__ import build_server

    tmp = tempfile.mkdtemp()
    return build_server(db_path=str(Path(tmp) / "wire.db"), ttl_days=90)


def _list_tools(mcp):
    async def _run():
        return await mcp.list_tools()

    return asyncio.run(_run())


class TestWireFormat:
    def test_report_usage_input_is_flat_envelope(self):
        """inputSchema == 批量信封: required=[reports], 无 payload 嵌套 (§2.1)。"""
        tools = _list_tools(_build())
        by_name = {t.name: t for t in tools}
        # t_2b9fa065: 数据面三工具 + 引导工具 get_onboarding_guide
        # v1.1 增补 (2026-09-24): + delete_usage (§2.4)
        assert set(by_name) == {
            "report_usage",
            "usage_summary",
            "usage_report_echo",
            "get_onboarding_guide",
            "delete_usage",
        }

        schema = by_name["report_usage"].parameters
        props = schema.get("properties", {})
        assert schema.get("required") == ["reports"]
        assert "payload" not in props
        assert "reports" in props

    def test_delete_usage_input_flat(self):
        """delete_usage 参数平铺: required=[agent_id], before_ts 可选 (§2.4)。"""
        tools = _list_tools(_build())
        by_name = {t.name: t for t in tools}
        schema = by_name["delete_usage"].parameters
        props = schema.get("properties", {})
        assert schema.get("required") == ["agent_id"]
        assert set(props) == {"agent_id", "before_ts"}
        assert "payload" not in props

    def test_data_plane_tools_v11(self):
        """v1.1 增补 (2026-09-24): 数据面 3 工具 + 引导工具 + delete_usage。
        维护/运维入口仍不在数据面 tools/list (终审复验 P2 #2)。"""
        names = {t.name for t in _list_tools(_build())}
        assert names == {
            "report_usage",
            "usage_summary",
            "usage_report_echo",
            "get_onboarding_guide",
            "delete_usage",
        }
