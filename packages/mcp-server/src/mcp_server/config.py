"""mcp.env 配置加载 — 独立产品形态 (f664d7b 文档修正后)。

配置落盘 ~/.config/token-wallet/mcp.env (app 生成/管理, daemon 读取):
  TOKEN_WALLET_MCP_KEY=<随机 32 hex>   必填 (app 与 daemon 共用)
  TOKEN_WALLET_PORT=9131
  TOKEN_WALLET_HOST=127.0.0.1
  TOKEN_WALLET_DB_PATH=~/.local/share/token-wallet/token-wallet.db
  USAGE_TTL_DAYS=90

优先级 (高→低): 进程 env > mcp.env > 代码缺省。
路径可被 env TOKEN_WALLET_MCP_ENV_PATH 覆盖 (测试注入用)。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# mcp.env 缺省位置: ~/.config/token-wallet/mcp.env (XDG_CONFIG_HOME 尊重)
DEFAULT_ENV_PATH = (
    Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    / "token-wallet"
    / "mcp.env"
)

# TOKEN_WALLET_HOST 缺省 127.0.0.1 — 独立产品本机优先 (0.0.0.0 是内部形态残留,
# 要远程暴露用户自行改 mcp.env / env)。
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9131
DEFAULT_TTL_DAYS = 90


def _expand(value: str) -> str:
    """~ 与 $VAR 双展开 (mcp.env 里的 TOKEN_WALLET_DB_PATH 含 ~)。"""
    return os.path.expandvars(os.path.expanduser(value))


def load_mcp_env(path: str | os.PathLike[str] | None = None) -> dict[str, str]:
    """读 mcp.env (简单 KEY=VALUE ini 形态), 返回 dict; 文件不存在返回空 dict。

    - 空行与 # 开头注释跳过
    - 值做 ~ / $VAR 展开
    - 不覆盖进程已有 env 的语义由调用方 (resolve_config) 处理
    """
    p = Path(path) if path is not None else Path(
        os.environ.get("TOKEN_WALLET_MCP_ENV_PATH") or DEFAULT_ENV_PATH
    )
    if not p.is_file():
        return {}
    parsed: dict[str, str] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            parsed[key] = _expand(value)
    return parsed


def resolve_config(
    *, mcp_env_path: str | os.PathLike[str] | None = None
) -> dict[str, str | int]:
    """合并配置: 进程 env > mcp.env > 缺省。缺 TOKEN_WALLET_MCP_KEY → fatal exit 1。"""
    file_cfg = load_mcp_env(mcp_env_path)

    def pick(key: str, default: str | int) -> str | int:
        if os.environ.get(key):
            return os.environ[key]
        if key in file_cfg:
            return file_cfg[key]
        return default

    key = pick("TOKEN_WALLET_MCP_KEY", "")
    if not key:
        print(
            "fatal: TOKEN_WALLET_MCP_KEY not set (mcp.env 或 env 任一提供; "
            "缺省位置 ~/.config/token-wallet/mcp.env)",
            file=sys.stderr,
        )
        sys.exit(1)

    return {
        "key": str(key),
        "db_path": str(pick("TOKEN_WALLET_DB_PATH", str(_default_db_path()))),
        "ttl_days": int(pick("USAGE_TTL_DAYS", DEFAULT_TTL_DAYS)),
        "host": str(pick("TOKEN_WALLET_HOST", DEFAULT_HOST)),
        "port": int(pick("TOKEN_WALLET_PORT", DEFAULT_PORT)),
    }


def _default_db_path() -> Path:
    if xdg := os.environ.get("XDG_DATA_HOME"):
        return Path(xdg) / "token-wallet" / "token-wallet.db"
    return Path.home() / ".local" / "share" / "token-wallet" / "token-wallet.db"
