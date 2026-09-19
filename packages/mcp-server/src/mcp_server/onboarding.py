"""引导接口数据源 — 唯一入口 get_onboarding_guide / GET /guide 共用。

OB-01 (onboarding 周期) 改版: 五段式文档分段数据 (guide_doc.doc_sections)
+ 单条目自适配标准 (S5, per-agent 占位条目删除)。兼容字段不动:
endpoint / server_version / build_id / agents — app 侧 build_id 陈旧检测链路
(t_1b396e2f) 与 mcp_get_guide IPC (OB-03 拆除前) 依赖这些键。
"""
from __future__ import annotations

import os
import re
import sys
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version

from . import guide_doc

# server_version: 包版本 (pyproject version, 与 _FALLBACK_VERSION 同号 — 测试守护),
# 取不到时回退
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


# 自适配标准单条目 (S5/B1: per-agent 条目模型推翻)。保留 agents 数组键与
# 条目字段形态 (id/name/plugin_url/docs_url/configure/verify) — JSON 视图
# 既有程序化消费方 (app mcp_get_guide) 的结构兼容窗口。
_AGENT_SELF_SERVICE: dict = {
    "id": "self-service",
    "name": "自适配标准（任何 agent）",
    "plugin_url": guide_doc.REFERENCE_IMPL_URL,
    "docs_url": None,
    "configure": "按 /guide 文档页五段式标准自助接入（概述→认证→接口规格→真实示例→验证步骤）",
    "verify": "上报一条 report_usage 后用 usage_summary / usage_report_echo 回读验证",
}


def server_version() -> str:
    try:
        return _pkg_version("token-wallet-mcp-server")
    except PackageNotFoundError:
        return _FALLBACK_VERSION


def onboarding_guide(endpoint: str) -> dict:
    """契约结构 (勿改既有字段): endpoint 根级 + server_version + build_id + agents。

    t_1b396e2f: build_id — daemon 构建标识, dev 源码运行为 None(JSON null);
    app 侧据此外判 daemon 是否陈旧。
    OB-01 新增 doc 字段 (追加不改义): 五段式文档分段, 渲染归 _render_guide_html,
    JSON 视图同样暴露 (程序化消费方可直接取分段)。
    """
    return {
        "endpoint": endpoint,
        "server_version": server_version(),
        "build_id": build_id(),
        "agents": [dict(_AGENT_SELF_SERVICE)],
        "doc": {
            "title": "token-wallet MCP — agent 自适配指南",
            "endpoint": endpoint,
            "server_version": server_version(),
            "sections": guide_doc.doc_sections(),
        },
    }
