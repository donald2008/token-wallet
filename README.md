# token-wallet

AI 套餐/额度桌面仪表盘 —— 多云平台订阅套餐(Coding Plan)与余额的统一实时视图,
并可叠加本地 Agent 的 token 消耗做"云 × 本地"对比。

> 状态: 早期开发(P0 骨架阶段)。设计文档见 [docs/DESIGN.md](docs/DESIGN.md),
> 决策记录见 [docs/DECISIONS.md](docs/DECISIONS.md)。

## 解决什么问题

多 Agent 工作流下, token 消耗分散在多家 provider 的多类套餐里
(5 小时滚动窗 / 7 天窗 / 月度额度 / 按量余额)。任一平台额度悄悄耗尽,
正在执行的任务链就会中断。token-wallet 把所有套餐的剩余量、窗口重置倒计时、
消耗速率集中到一个桌面部件上, 一瞥可读。

## 三种套餐原型

| 原型 | 代表 | 展示 |
|------|------|------|
| `window` 窗口制 | Kimi Code / 火山方舟 Coding Plan / 百炼 Token Plan | 多窗口进度条 + 重置倒计时 |
| `balance` 余额制 | DeepSeek / Kimi 开放平台 | 余额 + 按近期速率的预计可用天数 |
| `local` 本地用量 | 本地 Agent (Hermes 等) 的 token 消耗 | 用量列表 + "余额还够跑 N 天"对比行 |

## 架构

monorepo 三包, 同一采集核心三种宿主:

```
packages/
├── core/         采集核心: 适配器注册表 / 轮询调度 / 缓存 / 统一 schema (纯 TS 库)
├── app/          Electron 桌面部件: 系统托盘 + 弹出面板 + 可选悬浮窄条 (React 19)
└── mcp-server/   常驻数据面 daemon: 内嵌 core, 以 MCP 协议向 Agent 暴露查询能力
```

- **cache-first**: UI 只读本地快照缓存, 后台按 per-provider 周期同步, 断网可用
- **适配器即插件**: 标准余额接口 YAML 映射零代码接入; 复杂接口用 TS 适配器类
- **凭据可插拔**: env / 本地文件 / 外部命令(如 Consul KV), 仓库不落任何密钥

## 开发

```bash
pnpm install
pnpm dev        # 桌面部件 (packages/app, Electron 壳)
pnpm mcp        # MCP 数据面 daemon (packages/mcp-server)
```

要求: Node >= 22, pnpm 9。

## License

Apache-2.0
