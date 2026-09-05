"""Bearer 鉴权中间件 — spec §5。

一把 key (env TOKEN_WALLET_MCP_KEY, Consul 注入); 不豁免 loopback —
本机请求同样必须带 key, 全组件统一鉴权面。
"""
from __future__ import annotations

import hmac

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class BearerAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, key: str):
        super().__init__(app)
        self._expected = f"Bearer {key}".encode()

    async def dispatch(self, request: Request, call_next):
        header = request.headers.get("authorization", "").encode()
        # 常数时间比较, 不豁免任何来源 (含 loopback)
        if not header or not hmac.compare_digest(header, self._expected):
            return JSONResponse({"error": "unauthorized: missing or invalid bearer key"}, status_code=401)
        return await call_next(request)
