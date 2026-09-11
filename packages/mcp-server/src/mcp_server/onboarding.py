"""引导接口数据源 — 唯一入口 get_onboarding_guide / GET /guide 共用。

静态引导数据硬编码 (独立产品不需要动态发现); agent 条目结构定死,
后续由适配器扩展 (plugin_url/docs_url 可 null 占位)。
"""
from __future__ import annotations

import os
import re
import sys
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version

# server_version: 包版本 (pyproject 0.1.0 纪元), 取不到时回退
_FALLBACK_VERSION = "0.2.8"

# t_1b396e2f 版本一致性: daemon 自报 build_id, app 侧与本机 exe 内标记比对。
# 来源优先级: env TOKEN_WALLET_BUILD_ID (PyInstaller frozen 环境变量注入路径, 预留)
#           > exe/二进制字节流扫描 TW_MCP_BUILD_ID=<value> 标记 (build-exe.ps1 追加)
#           > None (dev 源码运行 / 旧 exe 未注入 — app 侧「双侧皆无」不判陈旧)
_BUILD_ID_MARKER = "TW_MCP_BUILD_ID="
_BUILD_ID_VALUE_RE = re.compile(r"TW_MCP_BUILD_ID=([0-9A-Za-z._-]+)")


def build_id() -> str | None:
    """daemon 自报构建标识 — 每次构建必变 (build-exe.ps1 注入), dev 运行为 None。"""
    env_val = os.environ.get("TOKEN_WALLET_BUILD_ID", "").strip()
    if env_val:
        return env_val
    if getattr(sys, "frozen", False):
        try:
            with open(sys.executable, "rb") as f:
                data = f.read()
            m = _BUILD_ID_VALUE_RE.search(data.decode("latin-1"))
            if m:
                return m.group(1)
        except OSError:
            pass
    return None

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
    """契约结构 (勿改): endpoint 根级 + server_version + agents 数组。

    t_1b396e2f 追加字段 (不改既有字段语义): build_id — daemon 构建标识,
    dev 源码运行为 None(JSON null); app 侧据此外判 daemon 是否陈旧。
    """
    return {
        "endpoint": endpoint,
        "server_version": server_version(),
        "build_id": build_id(),
        "agents": [dict(a) for a in _AGENTS],
    }
