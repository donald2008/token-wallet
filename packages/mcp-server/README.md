# @token-wallet/mcp-server

常驻数据面 daemon: 内嵌 `@token-wallet/core`, 独立目录独立部署,
以 MCP(streamable-http)向 Agent 暴露查询工具。

## 定位

不只是"给 Agent 的接口" —— 它是 7×24 的采集与持久化宿主:

```
providers ──> core(采集/归一化/缓存) ──> StorageBackend ──> MCP tools ──> agents
```

桌面 app 关闭不影响数据采集与 Agent 查询。

## 计划暴露的工具(P3)

| 工具 | 说明 |
|------|------|
| `quota_status` | 全部 provider 最新快照(等价 UI 一瞥) |
| `quota_history` | 按 provider/时间段/聚合粒度查历史(需 SqliteStore) |
| `agent_usage` | 本地 Agent 用量聚合(配合 LocalAgentAdapter) |

## 部署形态(我们自己环境)

njbx02 常驻运行, 凭据走 CommandSource 接 Consul KV, 桌面 app 以远程模式指向它。
