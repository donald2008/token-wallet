# token-wallet 设计文档

版本: v0.1 (2026-08-27 定稿)
状态: 待 P0 开工

## 1. 定位

独立的 AI 套餐/额度桌面仪表盘(开源, Apache-2.0)。统一展示多云平台的
订阅套餐(Coding Plan 窗口制)与按量余额, 并叠加本地 Agent token 消耗做
"云 × 本地"对比。解决多 Agent 工作流下"任一平台额度悄悄耗尽导致任务链中断"
的规划混乱。

非目标: 不做账单/发票管理、不做充值入口(只读监控)、不做用量归因到任务、
不做移动端。

## 2. 核心抽象: 三种套餐原型 (PlanArchetype)

| 原型 | 代表 | 核心指标 | 展示规则 |
|------|------|---------|---------|
| `balance` 余额制 | DeepSeek, Kimi 开放平台 | remaining/currency, granted/topped_up 拆分 | 余额大数字 + 按近 7 天速率的预计可用天数 |
| `window` 窗口制 | Kimi Code(5h滚动+7d+月), 方舟 Coding(5h/周/月), 百炼 Token Plan(7d Credits) | 多窗口嵌套, 每窗口 used/limit/reset_at | 每窗口一条进度条+重置倒计时; 最紧窗口置顶标红 |
| `local` 本地用量 | Hermes 各 agent token 消耗 | per agent/model 时段用量 | 用量列表 + 云×本地对比行 |

### 2.1 统一快照 schema (适配器唯一输出契约)

```json
{
  "provider_id": "kimi-code",
  "display_name": "Kimi Code",
  "plan_type": "window",
  "fetched_at": 1724900000,
  "status": "ok | stale | auth_expired | unsupported | error",
  "metrics": [
    {
      "key": "rolling_5h",
      "kind": "window",
      "unit": "requests | credits | cny | tokens",
      "used": 820,
      "limit": 1200,
      "reset_at": 1724903600
    }
  ],
  "alerts": []
}
```

`status` 是一等公民: auth_expired(控制台类登录态断, UI 亮黄灯)、
stale(超 2 个轮询周期未更新)、unsupported(暂无适配器, UI 显示
"暂不支持, 欢迎 PR")。异常状态用整卡文字替代图表, 不显示假数据。

## 3. 架构: monorepo 三包

```
token-wallet/
├── packages/
│   ├── core/         采集核心(纯 TS 库): 适配器注册表 / 调度器 / 缓存 / schema
│   ├── app/          Tauri 2 桌面部件(React 19): 托盘 + 弹出面板 + 可选悬浮窄条
│   └── mcp-server/   常驻数据面 daemon: 内嵌 core, MCP 暴露查询
├── docs/
├── sketches/         UI 视觉 mockup(评审用, 可丢弃)
└── package.json      pnpm workspace
```

三种部署形态一套代码:
- 开源用户: 只装 app(core 内嵌)
- 服务器: mcp-server headless 常驻
- 我们(njbx02): mcp-server 常驻(keys 走 Consul) + app 远程模式指向它 + 三兄弟 agent 走 MCP 查询

### 3.1 数据流: cache-first / stale-while-revalidate

```
适配器轮询(后台) ──写──> StorageBackend(JSONL + latest.json)
                              │
UI 启动/渲染 ────只读───────────┘   ← UI 永远不直接请求 provider
```

- UI 永远从本地缓存渲染: 启动即出数, 零网络等待, 断网可用
- 缓存超 TTL 未刷新 → 卡片自动转 stale 态, 标注"数据为 X 分钟前"
- 历史 JSONL 支撑消耗速率/预计可用天数
- 手动刷新 = 触发对应适配器立即同步

## 4. 四个注册点(框架边界)

```
ProviderAdapter   数据从哪来   generic-http(YAML 映射, 零代码) / scripted(TS 类) / local-agent
Template          数据怎么画   React 组件注册进 TemplateRegistry
CredentialSource  凭据从哪取   env / file / command(我们接 Consul KV 的口子)
Notifier          异常往哪报   P3 前空实现, 接口先行
```

收敛声明: core 机制通用(采集→归一化→缓存→分发), schema 语义限定套餐/用量领域;
不做热加载插件市场, 加平台 = 加适配器发新版。先实现再抽象, 接过 8-10 个平台后再谈进一步泛化。

## 5. 适配器体系

两级适配, 加新 T1 provider 零代码:

| 类型 | 用法 | 适用 |
|------|------|------|
| GenericHttpAdapter | YAML 声明 url/headers/JSONPath 映射 | DeepSeek /user/balance, OpenRouter /credits 等标准接口 |
| ScriptedAdapter | TS 类 | Kimi Code 逆向端点, 火山方舟 OpenAPI, 阿里云 CLI 包装 |
| LocalAgentAdapter | 拉 Hermes gateway /api/sessions 聚合 | 本地 agent 用量 |

### 5.1 各平台采集方式初判(待 P2 spike 验证)

| Provider | 路径 | 风险 |
|----------|------|------|
| deepseek-api | T1 官方 `GET /user/balance` | 无 |
| kimi-k3 (Kimi Code) | T2 逆向 CLI /usage 背后的 api.kimi.com 内部端点 | 中: 非公开接口可能变更 |
| volcengine (方舟 Coding) | T2 火山 OpenAPI/控制台 XHR(用户判断有对应 API) | 中 |
| aliyun token-plan | T2 阿里云 CLI(bssopenapi/百炼套餐接口) | 中 |
| meituan LongCat | 待查 | 中 |
| opencode-zen | T2 dashboard API | 低-中 |
| opencode-go | 已区域封锁, 标记"不可用"不采集 | — |

spike 产出 = YES/NO + 接口样本; NO 降级为 unsupported 卡片。

## 6. UI 设计

### 6.1 设计原则: Glanceability(一瞥可读)

1. 最坏情况优先排序: 卡片按剩余健康度动态排序
2. 颜色即状态: 绿/黄/红/灰四色承担全部语义, 无第五种强调色
3. 数字回答"还能撑多久": 余额配"预计可用天数", 窗口配重置倒计时

### 6.2 形态

- 主形态: 系统托盘 + 点击弹出面板(宽 ~360px), 托盘图标色点 = 全局最差状态, tooltip 摘要("2健康 1偏低 1过期")
- 可选形态: 桌面悬浮窄条
- 可最小化到托盘

### 6.3 模板与主题分离

- **Theme**(配色/密度): dark / light, 默认追随系统, 可配置覆盖
- **Template**(信息结构与视觉形态): 每原型一个默认模板, 用户可全局选或按 provider 覆盖

| 模板 | 视觉形态 | 适合原型 | 阶段 |
|------|---------|---------|------|
| bars | 横向进度条+压字 | window | MVP |
| ticker | 大数字+速率 | balance | MVP |
| gauge | 半圆仪表盘 | window/balance | P1 |
| battery | 电池格递减 | window(短周期) | P1 |
| ring-stack | 同心圆环嵌套窗口 | window | P1 |
| ledger | 表格流水 | local | P2 |

### 6.4 图表策略

Chart.js v4(react-chartjs-2)负责数据序列(消耗趋势等); 进度条/仪表盘/电池格等
状态微部件手绘 SVG。分工原则: "数据序列"走 Chart.js, "状态指示"走 SVG。
不引 echarts(太重) / 组件库(卡片/进度条/按钮手写)。

### 6.5 面板结构

```
标题栏: 全局状态点 / 手动刷新 / 设置
云端卡片区: 按健康度排序, 原型模板渲染
本地 Agent 区(默认折叠): per-agent 用量 + 云×本地对比行
```

## 7. 持久化

StorageBackend 接口 P0 定义, 双宿主约束: mcp-server 是 Node 进程, app 是 webview(无 Node API)。

| 实现 | 阶段 | 说明 |
|------|------|------|
| JsonlStore | MVP | 追加 JSONL + latest.json, 零依赖双宿主通用 |
| SqliteStore | P3 评估 | mcp-server 用 node:sqlite(Node 22+ 内置); app 走 Tauri sql plugin。当 MCP 需要应答 quota_history 区间聚合时引入 |

## 8. MCP 数据面

mcp-server 是 7×24 采集与持久化宿主, 不只是 Agent 接口:

```
providers ──> core(采集/归一化/缓存) ──> StorageBackend ──> MCP tools ──> agents
```

计划工具(P3): quota_status / quota_history / agent_usage。
协议: streamable-http, 复用我们 kanban-mcp 的 header 鉴权经验。
Agent 对接唯一通道 = MCP, 不维护第二套 HTTP API。

## 9. 告警

P3 实现, Notifier 接口 P0 先行(空实现), 配置 `notifications.enabled=false` 占位。
阈值触发 Windows 原生通知(Tauri notification), 同一告警冷却期防轰炸。

## 10. 阶段划分

| 阶段 | 内容 |
|------|------|
| P0 | monorepo 骨架 + core(schema/缓存/调度/generic-http) + app(托盘+面板+bars/ticker+健康度排序) + mock 适配器 + 首开向导 + 设置页 |
| P1 | deepseek 真实数据跑通 + 消耗速率/预计天数 + gauge/ring-stack/battery 模板 |
| P2 | 五家接口 spike → kimi-code/ARK/百炼/龙猫/opencode-zen 适配器 |
| P3 | mcp-server + LocalAgentAdapter + 云×本地对比行 + 通知(配置项) |
| P4 | i18n(zh 先行) + 发布(LICENSE/README/截图/updater) → GitHub 镜像 |
