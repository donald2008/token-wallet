"""daemon 本地时区解析 — spec §2.2/§4.2/§4.3 统一口径。

`day` 分组、`since` 缺省、usage_records 当日边界、TTL 凌晨调度一律用
daemon 本地时区; 响应 `timezone` 字段输出 IANA 名 (如 Asia/Shanghai)。

解析顺序:
  1. 显式参数 (测试注入)
  2. env TOKEN_WALLET_TZ (IANA 名; 容器/嵌入式等本地时区不可辨的部署兜底)
  3. 宿主时区反解 IANA 名: /etc/timezone (Debian 系) → /etc/localtime realpath
  4. %Z 探测 (Windows 等无 IANA 信息的平台, 输出缩写如 CST)
  5. str(tzinfo) 兜底
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

TZ_ENV_VAR = "TOKEN_WALLET_TZ"


def env_tz_name() -> Optional[str]:
    """env 覆盖值 (空串/未设 = None, 跟随宿主)。"""
    v = os.environ.get(TZ_ENV_VAR)
    return v if v and v.strip() else None


def _host_tz_name() -> Optional[str]:
    """Linux 宿主 IANA 名反解: /etc/timezone 优先, /etc/localtime 符号链接次之。"""
    try:
        txt = Path("/etc/timezone").read_text(encoding="utf-8").strip()
        if txt:
            return txt
    except OSError:
        pass
    try:
        real = os.path.realpath("/etc/localtime")
        if "/zoneinfo/" in real:
            return real.split("/zoneinfo/", 1)[1]
    except OSError:
        pass
    return None


def local_tz(tz_env: Optional[str] = None) -> tuple:
    """(tzinfo, IANA 名或最佳可用名)。tz_env 显式传入时优先 (测试注入)。"""
    name = tz_env if tz_env is not None else env_tz_name()
    if name:
        return ZoneInfo(name), name  # 非法名由 ZoneInfo 直接抛, fail-fast

    host = _host_tz_name()
    if host:
        try:
            return ZoneInfo(host), host
        except Exception:
            pass

    local = datetime.now().astimezone().tzinfo
    try:  # %Z 探测: 冬/夏令时缩写一致且形如缩写才输出 (避免 'UTC+08:00' 式自造名)
        p1 = datetime(2026, 1, 15, tzinfo=local).strftime("%Z")
        p2 = datetime(2026, 7, 15, tzinfo=local).strftime("%Z")
    except Exception:
        p1 = p2 = ""
    if p1 and p1.isupper() and p1 == p2:
        return local, p1
    return local, str(local)


def day_bounds(epoch: int, tz) -> tuple[int, int]:
    """某 epoch 秒在 tz 时区的 [当日 00:00, 次日 00:00) 边界 (epoch 秒) — §4.2。"""
    day_start = datetime.fromtimestamp(epoch, tz=tz).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return int(day_start.timestamp()), int((day_start + timedelta(days=1)).timestamp())
