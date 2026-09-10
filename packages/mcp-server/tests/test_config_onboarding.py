"""配置面 + 引导接口测试 (t_2b9fa065)。

覆盖:
- mcp.env 加载 (文件→dict, ~ 展开, 注释/空行跳过)
- 优先级: env > mcp.env > 缺省; 缺 KEY fatal exit 1
- TOKEN_WALLET_HOST 缺省 127.0.0.1 (独立产品本机优先)
- get_onboarding_guide MCP 工具契约结构 (endpoint 根级 + agents 含 null plugin_url)
- GET /guide JSON 与 MCP 工具同源; Accept: text/html → HTML 步骤页
"""
from __future__ import annotations

import asyncio
import json
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


class TestOnboardingGuide:
    def test_tool_contract_structure(self, tmp_path):
        """契约: endpoint 根级 + server_version + agents 数组; hermes 有 url,
        claude-code/opencode 的 plugin_url/docs_url 为 null。"""
        mcp = _build(tmp_path)
        data = _tool_data(mcp, "get_onboarding_guide")
        assert set(data) == {"endpoint", "server_version", "agents"}
        assert data["endpoint"] == f"http://{HOST}:{PORT}/mcp"
        assert isinstance(data["server_version"], str) and data["server_version"]

        agents = {a["id"]: a for a in data["agents"]}
        assert set(agents) == {"hermes", "claude-code", "opencode"}
        for a in agents.values():
            assert set(a) == {"id", "name", "plugin_url", "docs_url", "configure", "verify"}
        assert agents["hermes"]["plugin_url"] and agents["hermes"]["docs_url"]
        assert agents["claude-code"]["plugin_url"] is None
        assert agents["claude-code"]["docs_url"] is None
        assert agents["opencode"]["plugin_url"] is None

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
        client = self._client(tmp_path)
        r = client.get("/guide", headers={"Accept": "text/html"})
        assert r.status_code == 200
        assert "text/html" in r.headers["content-type"]
        body = r.text
        assert f"http://{HOST}:{PORT}/mcp" in body
        assert "Hermes Agent" in body
        assert "Claude Code" in body

    def test_mcp_endpoint_still_requires_bearer(self, tmp_path):
        """guide 开放不放松 /mcp 鉴权面。"""
        client = self._client(tmp_path)
        r = client.post("/mcp", json={})
        assert r.status_code == 401
