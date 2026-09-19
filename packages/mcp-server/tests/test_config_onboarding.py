"""配置面 + 引导接口测试 (t_2b9fa065)。

覆盖:
- mcp.env 加载 (文件→dict, ~ 展开, 注释/空行跳过)
- 优先级: env > mcp.env > 缺省; 缺 KEY fatal exit 1
- TOKEN_WALLET_HOST 缺省 127.0.0.1 (独立产品本机优先)
- get_onboarding_guide MCP 工具契约结构 (endpoint 根级 + agents 单条目 + doc 分段)
- GET /guide JSON 与 MCP 工具同源; Accept: text/html → 五段式文档页 (OB-01)
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from mcp_server import config as config_mod  # noqa: E402
from mcp_server import onboarding  # noqa: E402


# ------------------------------------------------------------ mcp.env 加载 --

class TestLoadMcpEnv:
    def test_missing_file_returns_empty(self, tmp_path):
        assert config_mod.load_mcp_env(tmp_path / "nope.env") == {}

    def test_parses_kv_comments_and_tilde(self, tmp_path):
        p = tmp_path / "mcp.env"
        p.write_text(
            "# comment line\n"
            "\n"
            "TOKEN_WALLET_MCP_KEY=abc123\n"
            "TOKEN_WALLET_DB_PATH=~/.local/share/token-wallet/token-wallet.db\n"
            "USAGE_TTL_DAYS=60\n",
            encoding="utf-8",
        )
        cfg = config_mod.load_mcp_env(p)
        assert cfg["TOKEN_WALLET_MCP_KEY"] == "abc123"
        assert cfg["TOKEN_WALLET_DB_PATH"] == str(
            Path.home() / ".local/share/token-wallet/token-wallet.db"
        )
        assert cfg["USAGE_TTL_DAYS"] == "60"

    def test_env_path_override(self, tmp_path, monkeypatch):
        p = tmp_path / "custom.env"
        p.write_text("TOKEN_WALLET_PORT=9999\n", encoding="utf-8")
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(p))
        assert config_mod.load_mcp_env()["TOKEN_WALLET_PORT"] == "9999"


# --------------------------------------------------------------- 优先级 ----

@pytest.fixture()
def clean_env(monkeypatch):
    """清掉宿主环境的 TOKEN_WALLET_* 干扰。"""
    for k in list(__import__("os").environ):
        if k.startswith("TOKEN_WALLET") or k == "USAGE_TTL_DAYS":
            monkeypatch.delenv(k)


class TestResolveConfig:
    def test_defaults_without_anything(self, tmp_path, monkeypatch, clean_env):
        # mcp.env 指向不存在文件 → 纯缺省 (KEY 缺 → fatal)
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(tmp_path / "no.env"))
        with pytest.raises(SystemExit) as ei:
            config_mod.resolve_config()
        assert ei.value.code == 1

    def test_host_default_is_loopback(self, tmp_path, monkeypatch, clean_env):
        p = tmp_path / "mcp.env"
        p.write_text("TOKEN_WALLET_MCP_KEY=k1\n", encoding="utf-8")
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(p))
        cfg = config_mod.resolve_config()
        assert cfg["host"] == "127.0.0.1"
        assert cfg["port"] == 9131
        assert cfg["ttl_days"] == 90

    def test_mcp_env_values_win_over_defaults(self, tmp_path, monkeypatch, clean_env):
        p = tmp_path / "mcp.env"
        p.write_text(
            "TOKEN_WALLET_MCP_KEY=fromfile\n"
            "TOKEN_WALLET_HOST=0.0.0.0\n"
            "TOKEN_WALLET_PORT=8123\n"
            "USAGE_TTL_DAYS=30\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(p))
        cfg = config_mod.resolve_config()
        assert cfg["key"] == "fromfile"
        assert cfg["host"] == "0.0.0.0"
        assert cfg["port"] == 8123
        assert cfg["ttl_days"] == 30

    def test_process_env_overrides_mcp_env(self, tmp_path, monkeypatch, clean_env):
        p = tmp_path / "mcp.env"
        p.write_text(
            "TOKEN_WALLET_MCP_KEY=fromfile\nTOKEN_WALLET_PORT=8123\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(p))
        monkeypatch.setenv("TOKEN_WALLET_PORT", "9200")
        monkeypatch.setenv("TOKEN_WALLET_MCP_KEY", "fromenv")
        cfg = config_mod.resolve_config()
        assert cfg["port"] == 9200
        assert cfg["key"] == "fromenv"

    def test_db_path_tilde_expanded_from_process_env(self, tmp_path, monkeypatch, clean_env):
        # app 托管 spawn 恒走 env 传 DB_PATH(~ 形态): env 来源同样要展开,
        # 否则 Windows 字面 ~ 目录打不开库 (t_da2fd1f1 实修)
        p = tmp_path / "mcp.env"
        p.write_text("TOKEN_WALLET_MCP_KEY=k1\n", encoding="utf-8")
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(p))
        monkeypatch.setenv("TOKEN_WALLET_DB_PATH", "~/.local/share/token-wallet/token-wallet.db")
        cfg = config_mod.resolve_config()
        assert cfg["db_path"] == str(Path.home() / ".local/share/token-wallet/token-wallet.db")

    def test_fatal_exit_when_no_key_anywhere(self, tmp_path, monkeypatch, clean_env):
        p = tmp_path / "mcp.env"
        p.write_text("TOKEN_WALLET_PORT=9131\n", encoding="utf-8")
        monkeypatch.setenv("TOKEN_WALLET_MCP_ENV_PATH", str(p))
        with pytest.raises(SystemExit) as ei:
            config_mod.resolve_config()
        assert ei.value.code == 1


# --------------------------------------------------------- 引导接口数据源 --

REPO_ROOT = Path(__file__).resolve().parents[3]

HOST, PORT = "127.0.0.1", 9131


def _build(tmp: Path):
    from mcp_server.__main__ import build_server, build_http_app

    db = str(tmp / "guide.db")
    return build_server(db_path=db, ttl_days=90, endpoint=f"http://{HOST}:{PORT}/mcp")


def _call_tool(mcp, name):
    async def _run():
        return await mcp.call_tool(name, {})

    return asyncio.run(_run())


def _tool_data(mcp, name: str) -> dict:
    """ToolResult → dict (content[0].text 是 JSON)。"""
    result = _call_tool(mcp, name)
    return json.loads(result.content[0].text)


class TestVersionPolicy:
    def test_fallback_version_matches_pyproject(self):
        """版本策略: _FALLBACK_VERSION 与 pyproject 声明同号 (读包版本源优先,
        回退值仅兜底 — 两者漂移 = 版本报数失真)。"""
        import tomllib

        pyproject = REPO_ROOT / "packages" / "mcp-server" / "pyproject.toml"
        data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
        assert onboarding._FALLBACK_VERSION == data["project"]["version"]


class TestOnboardingGuide:
    def test_tool_contract_structure(self, tmp_path):
        """契约 (OB-01 改版): endpoint 根级 + server_version + build_id + agents
        单条目 (S5 自适配标准, per-agent 占位删除) + doc 五段式分段。"""
        mcp = _build(tmp_path)
        data = _tool_data(mcp, "get_onboarding_guide")
        # 兼容字段 (t_1b396e2f 追加不改义): dev 运行无 frozen exe → build_id None
        assert set(data) == {"endpoint", "server_version", "agents", "build_id", "doc"}
        assert data["endpoint"] == f"http://{HOST}:{PORT}/mcp"
        assert isinstance(data["server_version"], str) and data["server_version"]
        assert data["build_id"] is None or isinstance(data["build_id"], str)

        # agents 单条目: 字段形态保留 (JSON 视图既有消费方结构兼容窗口)
        assert len(data["agents"]) == 1
        agent = data["agents"][0]
        assert set(agent) == {"id", "name", "plugin_url", "docs_url", "configure", "verify"}
        assert agent["id"] == "self-service"
        assert agent["plugin_url"]  # 参考实现链接在场
        assert agent["docs_url"] is None

        # doc 分段: 五段式完整
        doc = data["doc"]
        assert doc["endpoint"] == data["endpoint"]
        assert [s["id"] for s in doc["sections"]] == [
            "overview", "auth", "api", "example", "verify",
        ]

    def test_build_id_compat_field(self, tmp_path):
        """H2 继承: build_id 字段与语义保留 — app 陈旧检测链路依赖 (REQ-06)。"""
        monkey = pytest.MonkeyPatch()
        try:
            monkey.setenv("TOKEN_WALLET_BUILD_ID", "compat-abc")
            mcp = _build(tmp_path)
            data = _tool_data(mcp, "get_onboarding_guide")
            assert data["build_id"] == "compat-abc"
        finally:
            monkey.undo()

    def test_build_id_env_override(self, tmp_path, monkeypatch):
        """t_1b396e2f: env TOKEN_WALLET_BUILD_ID 优先 — 版本一致性自报源。"""
        monkeypatch.setenv("TOKEN_WALLET_BUILD_ID", "testbuild-123")
        assert onboarding.build_id() == "testbuild-123"
        mcp = _build(tmp_path)
        data = _tool_data(mcp, "get_onboarding_guide")
        assert data["build_id"] == "testbuild-123"

    def test_build_id_dev_is_none(self, monkeypatch):
        """dev(非 frozen) 无 env → None, app 侧不判陈旧。"""
        monkeypatch.delenv("TOKEN_WALLET_BUILD_ID", raising=False)
        assert onboarding.build_id() is None

    def test_tool_in_tools_list(self, tmp_path):
        mcp = _build(tmp_path)
        tools = asyncio.run(mcp.list_tools())
        assert "get_onboarding_guide" in {t.name for t in tools}


class TestGuideHttp:
    def _client(self, tmp_path):
        from mcp_server.__main__ import build_http_app
        from starlette.testclient import TestClient

        app = build_http_app(
            key="testkey",
            host=HOST,
            port=PORT,
            db_path=str(tmp_path / "http.db"),
            ttl_days=90,
        )
        return TestClient(app)

    def test_guide_json_same_source_as_tool(self, tmp_path):
        client = self._client(tmp_path)
        r = client.get("/guide", headers={"Accept": "application/json"})
        assert r.status_code == 200
        data = r.json()
        assert data["endpoint"] == f"http://{HOST}:{PORT}/mcp"
        # 同源: 与 MCP 工具返回逐字段一致
        mcp = _build(tmp_path)
        assert data == _tool_data(mcp, "get_onboarding_guide")

    def test_guide_json_needs_no_bearer(self, tmp_path):
        """引导数据无密钥, 不在 BearerAuth 之后 (浏览器/用户可直接看)。"""
        client = self._client(tmp_path)
        r = client.get("/guide")  # 无 Authorization header
        assert r.status_code == 200

    def test_guide_html_view(self, tmp_path):
        """SC-01: 五段式文档页完整渲染, 中文正文 + 英文代码/schema (S1/S4)。"""
        client = self._client(tmp_path)
        r = client.get("/guide", headers={"Accept": "text/html"})
        assert r.status_code == 200
        assert "text/html" in r.headers["content-type"]
        body = r.text
        assert f"http://{HOST}:{PORT}/mcp" in body
        # 五段式骨架 (S1)
        for anchor in ("overview", "auth", "api", "example", "verify"):
            assert f'id="{anchor}"' in body
        for title in ("概述", "认证", "接口规格", "真实示例", "验证步骤"):
            assert title in body
        # schema 段全文嵌入 (英文 schema, P3 checklist; esc 后 $defs 带转义引号)
        assert "AgentUsageReport" in body
        assert "&quot;$defs&quot;" in body
        assert "input_cache_hit" in body
        # 真实 payload (F1) 与 JSONRPC 框架
        assert "tools/call" in body
        assert "report_usage" in body
        # 认证段: Bearer 占位 + key 来源说明, 无真实 key (S4)
        assert "Bearer" in body
        assert "TOKEN_WALLET_MCP_KEY" in body
        # 参考实现链接 (S5)
        assert "hook-usage-reporter" in body

    def test_guide_html_self_contained(self, tmp_path):
        """SC-07 / REQ-07: 自包含离线渲染 — 零外部资源依赖。"""
        client = self._client(tmp_path)
        r = client.get("/guide", headers={"Accept": "text/html"})
        body = r.text
        # 无外链资源: 无外链 css/js/字体/@import (REQ-07)
        assert "<link" not in body
        assert "<script" not in body
        assert "@import" not in body
        assert 'src="http' not in body
        # 页面里出现的 http URL 只有: 本页 endpoint (展示值, 非资源引用)
        # 与参考实现 <a href> — 二者均非外部资源加载
        external_srcs = re.findall(r'(?:src|href)\s*=\s*"(https?://[^"]+)"', body)
        for url in external_srcs:
            assert url.startswith("https://gitee.com/ITEater/token-wallet"), url

    def test_mcp_endpoint_still_requires_bearer(self, tmp_path):
        """guide 开放不放松 /mcp 鉴权面。"""
        client = self._client(tmp_path)
        r = client.post("/mcp", json={})
        assert r.status_code == 401
