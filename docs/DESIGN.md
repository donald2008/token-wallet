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
适配器轮询(后台) ──写──> StorageBackend(SQLite)
                              │
UI 启动/渲染 ────只读───────────┘   ← UI 永远不直接请求 provider
```

- UI 永远从本地缓存渲染: 启动即出数, 零网络等待, 断网可用
- 缓存超 TTL 未刷新 → 卡片自动转 stale 态, 标注"数据为 X 分钟前"
- 历史快照支撑消耗速率/预计可用天数
- 手动刷新 = 触发对应适配器立即同步

### 3.2 调度器语义(D-027)

- **全异步并发**: 每实例独立调度循环, 同时刻并发采集, 故障完全隔离(单实例挂起/超时/报错不影响其他实例)
- **防重叠**: 上次采集未结束时下个周期跳过(记 skipped), 不叠加请求/子进程
- **超时硬切断**: http 默认 10s, command 默认 15s(可调), 超时即 kill/abort → 实例转 error
- **启动抖动**: 启动时首次采集加 0~30s 随机 jitter, 避免瞬时并发风暴
- **失败退避**: 连续失败指数退避(5→10→20→封顶 30min), 恢复后回到正常周期; auth_expired 直接停摆等用户处理
- **写库原子**: 每实例独立事务写自己的 snapshot, UI 永远读最新已落库数据

## 4. 四个注册点(框架边界)

```
ProviderAdapter   数据从哪来   generic-http(YAML 映射, 零代码) / scripted(TS 类) / local-agent
Template          数据怎么画   React 组件注册进 TemplateRegistry
CredentialSource  凭据从哪取   env / file / command(我们接 Consul KV 的口子)
Notifier          异常往哪报   P3 前空实现, 接口先行
```

收敛声明: core 机制通用(采集→归一化→缓存→分发), schema 语义限定套餐/用量领域;
不做热加载插件市场, 加平台 = 加适配器发新版。先实现再抽象, 接过 8-10 个平台后再谈进一步泛化。

## 5. 适配器体系: 预置通道 + 参数录入 (D-017)

**通道是预制代码, 录入只是填参数。** 每种平台是一个预置通道(channel),
仓库内置请求方式与映射规则; 用户添加 provider = 选通道 + 填参数, 不接触 YAML/JSONPath。

```
channels/  (两层模型: platform → product, D-025)
├── kimi/
│   ├── kimi-code/        http,  window,  params: { api_key }  (/coding/v1/usages 已实测)
│   └── kimi-platform/    http,  balance, params: { api_key }  (开放平台 /v1/users/me/balance)
├── aliyun-bailian/
│   ├── token-plan/       command(bl), window, params: { api_key }  (探针; 完整用量走 bl 会话)
│   ├── coding-plan/      command(bl), window, params: { api_key }
│   └── pay-as-you-go/    http, balance, params: { api_key }  (后置)
├── volcengine-ark/
│   ├── coding-plan/      command(arkcli), window, params: {}  (arkcli usage plan 已实测, SSO --no-browser 设备码登录)
│   ├── agent-plan/       command(arkcli), window, params: {}  (同命令自动发现, 已实测; 团队版需 --seat)
│   └── pay-as-you-go/    后置
├── deepseek/
│   └── balance/          http, balance, params: { api_key }  (/user/balance 已实测)
├── opencode/
│   ├── go/               http, window,  params: { api_key }  (/zen/go/v1/usage 已实测, 订阅窗口制)
│   └── zen/              http, balance, params: { api_key }  (按量付费, 余额端点待 spike)
└── custom-http/     高级通道: 暴露 URL+JSONPath 映射, 给折腾党(后置)
```

**平台 → 产品两层模型(D-025)**: 同一平台可有多种计费产品(coding plan 窗口制 / token plan / 按量余额),
端点、凭据、配额语义各不相同。添加流程 = 选平台 → 选产品 → 填参数。
同平台多产品实例在面板上可聚合为一张分组卡(内部分行)或独立成卡, 由模板层决定。

(longcat 暂缓, 见 backlog)

### 5.0 实现方式归类(D-018 / D-028 收敛, 由实战收敛)

**只保留两类**(D-028: session/控制台模拟类已移除, 不再维护):

| 类型 | 机制 | 通道 | 会话/凭据归属 |
|------|------|------|--------------|
| http | 单次 HTTP + Bearer key + JSON 映射 | deepseek / kimi-code / opencode | app 管 key |
| command | 包装官方 CLI 子进程, 解析 stdout JSON | aliyun(bl) / 火山方舟(arkcli) | CLI 自己管会话(SSO/登录态), app 零会话负担 |

(local-agent 本地用量为 P3 预留的第三类, 不属于云端套餐采集。)

command 类健康检查: 跑通道定义的 health_check 命令(如 `bl auth status` / `arkcli auth status`), 会话失效 → auth_expired, 卡片展示 setup_hint(如 `bl auth login --console` / `arkcli auth login --no-browser`)。

### 5.0.1 配置设计: 三层分离

```
内置通道目录(随 app 发布, 用户不可见)  ← ChannelDescriptor: 实现类型+请求细节+映射规则+params_schema
实例配置 instances.yaml(用户数据)      ← 启用哪些通道实例 + 参数 + 轮询覆盖
全局设置 settings(用户数据)            ← 主题/模板/默认轮询/通知开关
```

instances.yaml 示例(用户唯一能看到的配置面):

```yaml
version: 1
instances:
  - id: deepseek
    channel: deepseek/balance
    name: "DeepSeek-按量 #1"          # 必填, 全局唯一; 默认 "<平台>-<产品> #N" 自动编号
    params:
      api_key: { source: store }       # store = 设置页录入的加密存储; env/command 供 headless
  - id: deepseek-2
    channel: deepseek/balance
    name: "DS-小号"                    # 用户自定义, 便于面板区分账号
    params:
      api_key: { source: store }
  - id: kimi
    channel: kimi/kimi-code
    name: "Kimi Code #1"
    poll_interval: 3m                   # 可选, 覆盖全局默认
    params:
      api_key: { source: store }
  - id: aliyun
    channel: aliyun-bailian/token-plan
    name: "百炼 Token Plan"
    params:
      api_key: { source: store }       # sk-sp, 探针模式用; 完整用量依赖 bl 会话
  - id: ark
    channel: volcengine-ark/coding-plan
    name: "方舟-Coding #1"
    params: {}                           # command 类零凭据, 会话由 arkcli auth 维护
```

实例命名规则(D-026): 同平台同产品允许多实例(多账号); `name` 必填且全局唯一,
默认 "<平台>-<产品> #N" 自动编号(如 `DeepSeek-按量 #1`、`Kimi-Code #1`), 平台名前缀保证面板上可辨识;
表单保存即时校验 + instances.yaml 加载 zod 双重拒绝重复;
面板卡片标题显示实例名, 悬停显示 platform/product 全路径。

凭据引用统一为 CredentialRef `{source: store|env|file|command, key?}`:
桌面用户用 store(设置页写入); headless 部署用 env/command(我们接 Consul KV)。

加载与校验: instances.yaml 用 zod 校验 fail-fast; mtime watch 热加载;
实例校验连带检查通道存在性 + params_schema 完整性 + credential source 可解析。
表单校验与实例校验复用同一 zod schema。

### 5.0 通道描述符 (ChannelDescriptor)

```json
{
  "channel": "deepseek",
  "display_name": "DeepSeek",
  "plan_type": "balance",
  "logo": "deepseek",
  "params_schema": [
    {"key": "api_key", "label": "API Key", "type": "secret", "required": true,
     "help": "platform.deepseek.com → API Keys"}
  ]
}
```

- 设置页"添加 Provider": 通道选择器(logo 网格) → 动态表单(params_schema 生成,
  secret 字段密码框, 不回显已存密钥) → **测试连接**(立即跑一次采集, 成功显示余额快照,
  失败显示具体错误) → 保存即上面板
- 表单校验与实例配置校验复用同一份 zod schema
- 实例持久化: `{id, channel, poll_interval?, params: {k: CredentialRef}}`,
  凭据值走 CredentialSource, 实例配置只存引用
- 两条录入路径等价: 设置页 UI(桌面用户) / 实例配置文件(mcp-server headless, 我们用 command 源接 Consul KV)

### 5.1 通道实现两级(内部机制, 用户不可见)

| 类型 | 用法 | 适用 |
|------|------|------|
| GenericHttpAdapter | 通道内置 URL/headers/JSONPath 映射 | DeepSeek /user/balance, OpenRouter /credits 等标准接口 |
| ScriptedAdapter | TS 类 | Kimi Code 逆向端点, 火山方舟签名, 阿里云 CLI 包装 |
| LocalAgentAdapter | 拉 Hermes gateway /api/sessions 聚合 | 本地 agent 用量 |

能力边界: 需要签名、多步请求、派生计算(reset_at 推算)、会话保活 → scripted;
generic-http 只接"一次请求+静态映射"。

安全约束: JSONPath 用 jsonpath-plus 纯求值; 状态断言用受限比较表达式,
禁止 eval/new Function; 管道过滤器白名单(number/string/round/duration)。

### 5.2 各平台采集方式初判(待 P2 spike 验证)

| Provider | 路径 | 风险 |
|----------|------|------|
| deepseek-api | T1 官方 `GET /user/balance` | 无 |
| kimi-k3 (Kimi Code) | **已实测通过(2026-08-27)**: `GET https://api.kimi.com/coding/v1/usages`, KIMI_K3_KEY(sk-kimi-xxx)直接可用, 返回主配额(usage)+滚动窗(limits[].window)+会员等级+并行数+加油包(boosterWallet)。注意: 非官方文档接口, 可能变动 | 低: 接口已验证, 用 golden sample 测试防变更 |
| volcengine 方舟 | **已实测通过(2026-08-27)**: arkcli command 类 — `arkcli auth login --no-browser`(SSO 设备码两段式, 无头可用) + `arkcli usage plan --all` 一条命令覆盖 Coding Plan/Agent Plan × 个人/团队 4 SKU(团队版需 --seat)。Cookie 控制台 XHR(GetCodingPlanUsage)降级为备用参考 | 低: 官方 CLI 管会话 |
| aliyun token-plan | **bl CLI 路线**(`bl usage token-plan --output json`, 控制台会话由 CLI 维护), 待 2026-08-29 套餐重置后实测验证(当前额度耗尽 429, 计划用户本机 `bl auth login --console` 后移植 config.json)。已证伪: 子账号 AK/SK 路线(个人版不对子账号开放 Console 网关)。Cookie 重放方案已随 D-028 一并移除 | 中: 待重置后实测定案 |
| meituan LongCat | 待查 | 中 |
| opencode | **go 已实测(2026-08-27)**: `GET https://opencode.ai/zen/go/v1/usage` 返回 rolling/weekly/monthly 三窗 {status, percent, resetsAt}。**zen 是按量付费(balance)**, 余额端点待 spike(/zen/v1/usage 返回 SPA 非 API)。注: zen/go key 打 go 端点返回一致数据(账户级), 推理被地域封锁但用量 API 可达 | go 低 / zen 中 |

spike 产出 = YES/NO + 接口样本; NO 降级为 unsupported 卡片。

## 6. UI 设计

### 6.1 设计原则: Glanceability(一瞥可读)

1. 最坏情况优先排序: 卡片按剩余健康度动态排序
2. 颜色即状态: 绿/黄/红/灰四色承担全部语义, 无第五种强调色
3. 数字回答"还能撑多久": 余额配"预计可用天数", 窗口配重置倒计时
4. 品牌 logo 识别先于文字: 卡片名称左侧 16px 品牌色块, 一眼定位平台(正式版内置单色 SVG 品牌图标, 不依赖外网 favicon)

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
| SqliteStore | **P0 主力(D-020)** | 每时段×每模型×每 provider 消耗记录 + 聚合查询。app 走 tauri-plugin-sql(Rust 侧执行); mcp-server 走 node:sqlite(Node 22+ 内置)。同一 schema |
| JsonlStore | 调试/导出 | 快照导出为人可读 JSONL, 非主存储 |

SQLite schema 核心表:
- `snapshots(id, provider_id, fetched_at, status, raw_json)` — 原始快照
- `usage_records(id, provider_id, model, window_start, window_end, tokens, credits, cost_cny)` — 分模型分时段消耗(本地 agent 通道与云端窗口数据都落这张)

### 7.1 存储位置: 按平台解析, 零硬编码(D-019)

| 数据类型 | Windows | macOS | Linux | API |
|---------|---------|-------|-------|-----|
| 配置(instances.yaml/settings) | %APPDATA%\token-wallet\ | ~/Library/Application Support/ | ~/.config/token-wallet/ | Tauri app_config_dir |
| 快照数据(JSONL/SQLite) | %LOCALAPPDATA%\token-wallet\ | 同上 | ~/.local/share/token-wallet/ | Tauri app_data_dir(大文件不进 Roaming) |
| 凭据(store 源) | Windows 凭据管理器 | Keychain | Secret Service | keyring crate; headless 降级 600 权限文件 |

- 代码零路径字面量; mcp-server(Node 侧)用 env-paths 保持同一约定
- 配置与数据分家: 清缓存不丢配置
- 设置页显示运行时解析的真实路径, 不写死示例路径

## 8. MCP 数据面

mcp-server 是 7×24 采集与持久化宿主, 不只是 Agent 接口:

```
providers ──> core(采集/归一化/缓存) ──> StorageBackend ──> MCP tools ──> agents
```

计划工具(P3): quota_status / quota_history / agent_usage。
协议: streamable-http, 复用我们 kanban-mcp 的 header 鉴权经验。
Agent 对接唯一通道 = MCP, 不维护第二套 HTTP API。

## 9. 告警与状态阈值

状态四色: 绿(健康) / 黄(低于黄线) / 红(低于红线) / 灰(unsupported/stale)。

- **阈值全局可配置(D-022)**: 黄线默认 30%, 红线默认 10%(剩余百分比); 设置页可调
- auth_expired / 额度耗尽(100%) 恒为红, 不走阈值
- 通知 P3 实现, Notifier 接口 P0 先行(空实现), 配置 `notifications.enabled=false` 占位
- 阈值触发 Windows 原生通知(Tauri notification → 操作中心), 同一告警冷却期防轰炸
- 我们自己的部署可另接 MM 作战室通道

## 10. 分发与首开(D-021)

- Windows 标准安装包(Tauri NSIS),  installs per-user
- 首开向导: **隐私声明页(零遥测/零上报/数据不出本机, 须点同意)** → 引导添加第一个 provider(通道选择器)
- 初始状态零 provider 配置
- 托盘/应用图标: 自设计 token-wallet logo
- 开机自启: 设置页开关, **默认关**
- command 通道依赖检测与安装(D-023): 添加 aliyun-plan 实例时检测 `bl` 是否在 PATH,
  缺失则显示"一键安装"按钮 — app spawn PowerShell 跑官方二进制脚本(`irm https://bailian.aliyun.com/cli/install.ps1 | iex`, 无需 Node),
  stdout 实时流入设置页的 log 抽屉展示进度; 装完引导 `bl auth login --console`

## 11. 阶段划分

| 阶段 | 内容 |
|------|------|
| P0 | monorepo 骨架 + core(schema/缓存/调度/generic-http) + app(托盘+面板+bars/ticker+健康度排序) + mock 适配器 + 首开向导 + 设置页 |
| P1 | deepseek 真实数据跑通 + 消耗速率/预计天数 + gauge/ring-stack/battery 模板 |
| P2 | 五家接口 spike → kimi-code/ARK/百炼/龙猫/opencode-zen 适配器 |
| P3 | mcp-server + LocalAgentAdapter + 云×本地对比行 + 通知(配置项) |
| P4 | i18n(zh 先行) + 发布(LICENSE/README/截图/updater) → GitHub 镜像 |
