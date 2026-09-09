"""引导接口数据源 — 唯一入口 get_onboarding_guide / GET /guide 共用。

静态引导数据硬编码 (独立产品不需要动态发现); agent 条目结构定死,
后续由适配器扩展 (plugin_url/docs_url 可 null 占位)。
"""
from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version

# server_version: 包版本 (pyproject 0.1.0 纪元), 取不到时回退
_FALLBACK_VERSION = "0.2.8"

# agents 列表: 静态引导数据, 结构定死 (id/name/plugin_url/docs_url/configure/verify)
_AGENTS: list[dict] = [
    {
        "id": "hermes",
        "name": "Hermes Agent",
        "plugin_url": "https://gitee.com/IT_codef/token-wallet/-/tree/master/packages/hook-usage-reporter",
        "docs_url": "https://gitee.com/IT_codef/token-wallet/-/blob/master/README.md",
        "configure": (
            "endpoint + key 填到 hermes 插件配置的 "
            "TOKEN_WALLET_MCP_ENDPOINT / TOKEN_WALLET_MCP_KEY"
        ),
        "verify": "hermes 侧查 usage_summary 是否收到上报",
    },
    {
        "id": "claude-code",
        "name": "Claude Code",
        "plugin_url": None,
        "docs_url": None,
        "configure": "（待适配器实现后补）",
        "verify": "（待补）",
    },
    {
        "id": "opencode",
        "name": "OpenCode",
        "plugin_url": None,
        "docs_url": None,
        "configure": "（待适配器实现后补）",
        "verify": "（待补）",
    },
]


def server_version() -> str:
    try:
        return _pkg_version("token-wallet-mcp-server")
    except PackageNotFoundError:
        return _FALLBACK_VERSION


def onboarding_guide(endpoint: str) -> dict:
    """契约结构 (勿改): endpoint 根级 + server_version + agents 数组。"""
    return {
        "endpoint": endpoint,
        "server_version": server_version(),
        "agents": [dict(a) for a in _AGENTS],
    }
