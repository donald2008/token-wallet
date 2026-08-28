# @token-wallet/core

采集核心(纯 TS 库, 无 UI、无网络监听), 三种宿主共用: `app` 内嵌 / `mcp-server` 内嵌 / 测试。

## 职责

- **ProviderAdapter 注册表** — 数据从哪来
  - `GenericHttpAdapter`: YAML 声明 url/headers/JSONPath 映射, 标准余额接口零代码接入
  - `ScriptedAdapter`: TS 类, 处理多窗口/签名/CLI 包装等复杂逻辑
  - `LocalAgentAdapter`: 拉本地 Agent(如 Hermes gateway)用量
- **轮询调度器** — per-provider interval, 默认 5min(T2 档), D-027 全语义(并发/防重叠/超时硬切/启动抖动/失败退避/auth_expired 停摆)
- **StorageBackend** — cache-first 快照存储
  - P0 主力: `SqliteStore`(node:sqlite, D-020; app 侧 tauri-plugin-sql 同一 schema)
  - 调试导出: `JsonlStore`(后置)
- **统一 schema** — `ProviderSnapshot` zod 校验(见 docs/DESIGN.md §2.1)
- **CredentialSource** — store(宿主注入钥匙串) / env / file(强制 600) / command 四种凭据来源(D-029)
- **Notifier** — 接口先行, P3 前为空实现

## 边界(防过度设计)

core 的机制通用(周期采集 → 归一化 → 缓存 → 分发), 但 schema 语义就是套餐/用量领域,
不做任意数据平台框架; 不做热加载插件市场, 加平台 = 发新版。
