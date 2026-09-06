# @token-wallet/mcp-server

常驻数据面 daemon: 内嵌 `@token-wallet/core`, 独立目录独立部署,
以 MCP(streamable-http)向 Agent 暴露查询工具。

## 定位

不只是"给 Agent 的接口" —— 它是 7×24 的采集与持久化宿主:

```
providers ──> core(采集/归一化/缓存) ──> StorageBackend ──> MCP tools ──> agents
```

桌面 app 关闭不影响数据采集与 Agent 查询。

**唯一数据访问面(D-048)**: agent hook 上报 LLM 消耗、app 展示、agent 自查
全走 MCP 工具; SQLite(`<dataDir>/token-wallet.db`)是 daemon 私有实现细节,
其他组件禁止直查库。协议权威源 = [`docs/mcp-protocol.md`](../../docs/mcp-protocol.md)。

## 工具面

### v1(当前定稿, 协议见 docs/mcp-protocol.md)

| 工具 | 方向 | 说明 |
|------|------|------|
| `report_usage` | 写 | Agent hook 批量上报 LLM 消耗(1-100 条 AgentUsageReport v1, event_id 幂等 + fingerprint 两级判重) |
| `usage_summary` | 读聚合 | 按窗口/agent/provider/model/kanban_task 过滤, group_by ≤3 维聚合出 rows+total |
| `usage_report_echo` | 读原文 | 按 event_id/session_id/时间段回读落库原文, 验收自证 + 对账视图 |

### 二期(预览)

| 工具 | 说明 |
|------|------|
| `quota_status` | 全部 provider 最新快照(等价 UI 一瞥) |
| `quota_history` | 按 provider/时间段/聚合粒度查历史(需 SqliteStore) |

## 部署形态(我们自己环境)

- njbx02 常驻: **Python fastmcp**, 端口 **9131**, streamable-http, 端点 `/mcp`
- Bearer 一把 key `TOKEN_WALLET_MCP_KEY`(Consul `ai-hermes/security/providers/token-wallet-mcp-key`
  注入 env, 照 kanban-mcp-server 的 API_SERVER_KEY 模式; 不豁免 loopback)
- systemd user service 常驻(照 kanban-mcp-server-ops 模式) + Consul 服务注册
  (ai-microservice-registry 模式, 服务名 `token-wallet-mcp`)
- TTL: env `USAGE_TTL_DAYS`, 缺省 90(usage_events 明细; usage_records 聚合长期保留)
- 桌面 app 以远程模式指向 :9131, 切远程后停止本地采集(本地模式边界见 spec §6)

## 部署(daemon 实现, Python)

```bash
# 1. 环境(任意 Python >=3.11)
cd packages/mcp-server
python3 -m venv .venv && .venv/bin/pip install -e .

# 2. key 注入(不要写进 unit 文件)
#    Consul KV: ai-hermes/security/providers/token-wallet-mcp-key
#    渲染到 ~/.config/token-wallet/mcp.env :
#      TOKEN_WALLET_MCP_KEY=<consul 值>
mkdir -p ~/.config/token-wallet

# 3. systemd user unit
mkdir -p ~/.config/systemd/user
cp deploy/token-wallet-mcp.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now token-wallet-mcp
loginctl enable-linger $(whoami)   # 未登录也常驻

# 4. 验证
systemctl --user status token-wallet-mcp
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9131/mcp   # 401 = 鉴权面正常
```

env 一览: `TOKEN_WALLET_MCP_KEY`(必填, 无缺省) / `TOKEN_WALLET_DB_PATH`
(缺省 `~/.local/share/token-wallet/token-wallet.db`) / `TOKEN_WALLET_PORT`(9131)
/ `TOKEN_WALLET_HOST`(0.0.0.0) / `USAGE_TTL_DAYS`(90)。

TTL 维护手动触发(验收/运维, 不在 agent 数据面 tools/list):

```bash
# 注意: python -c '单引号里的 ~ 不会展开' — 必须用绝对路径(或脚本内 Path.home())
cd packages/mcp-server && PYTHONPATH=src .venv/bin/python -c \
  'from mcp_server.__main__ import run_maintenance_once; \
   print(run_maintenance_once(db_path="/home/<user>/.local/share/token-wallet/token-wallet.db", ttl_days=90))'
```

测试: `.venv/bin/pip install pytest && .venv/bin/python -m pytest tests/ -q`
(含 spec §8 fixture F1-F5 + F6 交叉守卫负例, F5 按"每组独立库"跑)。
