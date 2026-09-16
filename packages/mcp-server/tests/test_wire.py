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
        assert set(by_name) == {
            "report_usage",
            "usage_summary",
            "usage_report_echo",
            "get_onboarding_guide",
        }

        schema = by_name["report_usage"].parameters
        props = schema.get("properties", {})
        assert schema.get("required") == ["reports"]
        assert "payload" not in props
        assert "reports" in props

    def test_data_plane_has_only_three_tools(self):
        """维护/运维入口不在数据面 tools/list (终审复验 P2 #2)。
        引导工具 get_onboarding_guide 属于接入面, 随数据面一并暴露 (t_2b9fa065)。"""
        names = {t.name for t in _list_tools(_build())}
        assert names == {
            "report_usage",
            "usage_summary",
            "usage_report_echo",
            "get_onboarding_guide",
        }
