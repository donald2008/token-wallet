<div align="center">

# 💳 token-wallet

**你的 AI 额度，一瞥即知。** 别再让跑了三小时的任务链，死于一家平台的配额悄悄清零。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React%2019-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![平台通道 8](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0%E9%80%9A%E9%81%93-8-6E56CF)](#支持的通道)
[![gitee 主仓](https://img.shields.io/badge/gitee-ITEater%2Ftoken--wallet-C71D23?logo=gitee&logoColor=white)](https://gitee.com/ITEater/token-wallet)
[![English](https://img.shields.io/badge/docs-English-blue)](README.en.md)

**DeepSeek · Kimi · opencode · 智谱 GLM · MiniMax · 阿里云百炼 · 火山方舟 · 小米 MiMo** ——
八家 AI 平台的额度窗口，收进一枚 360×720px 的桌面部件：进度条、重置倒计时、按消耗速率估算的「还能用几天」。

> **多 Agent 时代的隐形炸弹**：token 消耗散落在各家套餐里 —— 5 小时滚动窗、周窗、月窗、按量余额。
> 深夜的长任务挂了，你翻遍终端才发现：某家的额度两小时前就没了。**token-wallet 把这种死法从你的工作流里删除。**

| Dark | Light | Glass |
|------|-------|-------|
| ![dark](docs/screenshots/panel-dark.png) | ![light](docs/screenshots/panel-light.png) | ![glass](docs/screenshots/panel-glass.png) |

**本地 Agent 用量大屏**（实时 token 消耗 / 成本 / 缓存命中 — Dark / Light / Glass，
数据由 MCP 数据面自动采集，见[下文](#本地-agent-用量采集mcp-数据面)）：

| 大屏 Dark | 大屏 Light | 大屏 Glass |
|------|------|------|
| ![dashboard dark](docs/screenshots/dashboard-dark.png) | ![dashboard light](docs/screenshots/dashboard-light.png) | ![dashboard glass](docs/screenshots/dashboard-glass.png) |

**填 Key 即用 · app 内一键授权（CLI / 会话登录）· 零遥测 · 数据不出本机**

[![下载 Windows 安装包](https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-Windows_%E5%AE%89%E8%A3%85%E5%8C%85-6E56CF?logo=windows&logoColor=white)](https://gitee.com/ITEater/token-wallet/releases/download/stable/token-wallet_setup.exe)

</div>

## 解决什么问题

多 Agent 工作流下，token 消耗分散在多家 provider 的多类套餐里
（5 小时滚动窗 / 7 天窗 / 月度额度 / 按量余额）。任一平台额度悄悄耗尽，
正在执行的任务链就会中断。token-wallet 把所有套餐的剩余量、窗口重置倒计时、
消耗速率集中到一个桌面部件上，一瞥可读。

## 架构

```text
  ┌────────────────────────────────────────────────┐
  │                Electron 桌面部件 (app)          │
  │  弹出面板 360×720 (React 19)  ·  设置页 · 添加向导 │
  └───────────────┬────────────────────────────────┘
                  │ 只读本地缓存 (cache-first, 断网可用)
  ┌───────────────▼────────────────────────────────┐
  │              StorageBackend (SQLite)            │
  │   历史快照 → 消耗速率 / 预计可用天数             │
  └───────────────▲────────────────────────────────┘
                  │ 后台轮询写入 (每实例独立调度循环)
  ┌───────────────┴────────────────────────────────┐
  │      适配器层 (core / packages/core)            │
  │  http 直连 (DeepSeek/Kimi/opencode/智谱)        │
  │  command CLI 包装 (百炼 bl / 火山 arkcli)        │
  └────────────────────────────────────────────────┘
```

- UI 永远从本地缓存渲染：启动即出数，零网络等待，断网可用
- 每实例独立采集循环：并发、故障隔离、超时硬切断、失败指数退避
- 异常显式化：key 失效 / CLI 缺失 / 会话过期 → 卡片给出明确修复指引
- 凭据存 OS 钥匙串，配置文件只存引用（详见 docs/DESIGN.md）

## 功能特点

- **八家平台额度一屏**：窗口制（多窗进度条 + 重置倒计时）与余额制（余额 + 预计可用天数）统一呈现
- **提前预警，而不是事后报错**：按近期消耗速率外推「预计可用天数」，额度吃紧卡片先变色
- **异常显式化**：key 失效 / CLI 缺失 / 会话过期，卡片直接给修复指引或一键「重新授权」按钮，绝不显示假数据
- **填 Key 即用，CLI / 会话授权不碰命令行**：HTTP 通道粘贴 Key 即用；百炼 / 火山方舟在 app 内一键安装 CLI 并弹浏览器授权；小米 MiMo 应用内登录一次自动截取会话（无需手抄 Cookie）
- **三主题 + 玻璃透明度**：dark / light / glass 随系统或手动切换，玻璃档位拖动滑槽实时预览、停即保存
- **手动拖拽排序**：拖卡片浮起即接管排序，松手一次持久化
- **数据不出本机**：零遥测零上报，凭据存 OS 钥匙串，快照落本地 SQLite，断网可看最后一次数据

## 本地 Agent 用量采集（MCP 数据面）

桌面的「本地 Agent 用量大屏」不是手动喂的——由 **MCP 数据面**自动采集。跑多个 AI Agent（Hermes /
Claude Code / opencode / Codex 等）时，它们的 token 消耗与成本通过标准 MCP 接口自动入库，
桌面部件汇总成大屏；同一数据面也开放给 Agent 程序化自查。

**工作方式**：

- **Agent 侧（hook 插件）**：挂在 agent harness 的 LLM 调用点，每次调用自动提取用量并批量上报
  （断线排队、重发幂等、零阻塞主流程）；任意 agent 均可依 `/guide` 标准自助接入
- **数据面（daemon）**：7×24 常驻的 MCP server，端点 `http://127.0.0.1:9131/mcp`（streamable-http，
  Bearer 鉴权）；桌面 app 关闭不影响采集与查询
- **桌面 app**：发现 daemon 后自动切换为其展示面板，无需额外配置

**MCP 工具面（v1 三个工具）**：

| 工具 | 方向 | 用途 |
|------|------|------|
| `report_usage` | 写 | Agent hook 批量上报 LLM 消耗（event_id 幂等 + 内容指纹两级判重，重发安全） |
| `usage_summary` | 读聚合 | 按时间窗 / agent / provider / model 过滤聚合，成本按内置价目表补算 |
| `usage_report_echo` | 读原文 | 回读上报原文，对账与验收自证 |

**部署与配置（app 内一键）**：

MCP 服务组件（Python fastmcp sidecar）按需分发：**首次使用在面板点「安装 MCP 服务」一键下载**
（约 30 MB，之后离线可用），无需单独装 Python 环境。装好 app 后：

1. **安装（仅首次）**：设置页「**MCP 服务**」面板点「**安装 MCP 服务**」——下载组件并自动启动，
   起在 `127.0.0.1:9131/mcp`
2. **日常启停**：状态一瞥（运行中 / 未运行），点「**一键启动**」随时拉起 daemon
3. 「**开机自启**」开关：登录系统自动拉起 daemon，不依赖桌面 app 是否打开
4. **API Key 全自动管理**：app 生成随机 key 写入 `mcp.env`（Linux/macOS `~/.config/token-wallet/mcp.env`，
   Windows `%APPDATA%\token-wallet\mcp.env`），面板内一键复制；「随机生成」换 key 后按提示重启 daemon 生效
5. **Agent 接入**：面板点「**复制引导链接**」，把链接发给你用的 agent——agent 打开
   `/guide` 自适配标准文档（五段式：概述→认证→接口规格→真实示例→验证步骤），
   自行完成 MCP 客户端接入与用量上报，无需人工按 harness 逐一配置；
   Hermes 官方实现见 [hook-usage-reporter](packages/hook-usage-reporter/)（参考实现）
6. 升级 app 后检测到旧版本 daemon 残留进程时，面板提示「一键重启」完成换代

配置项（`mcp.env`，一般无需手改）：

| 变量 | 缺省 | 说明 |
|------|------|------|
| `TOKEN_WALLET_MCP_KEY` | app 自动生成 | Bearer 鉴权 key（本机请求同样必须携带） |
| `TOKEN_WALLET_PORT` | `9131` | daemon 监听端口 |
| `USAGE_TTL_DAYS` | `90` | 明细保留天数（每日自动聚合长期趋势，聚合长期保留） |

**无 app 环境**（服务器/无头机）：手动部署（venv + systemd user service）见
[mcp-server/README](packages/mcp-server/README.md)，配置项同上。
协议规范见 [docs/mcp-protocol.md](docs/mcp-protocol.md)（AgentUsageReport v1 / 判重 / TTL / 鉴权）。

## 支持的通道

| 平台 | 产品 | 计费形态 | 接入方式 | 需要什么 |
|------|------|----------|----------|----------|
| DeepSeek | 按量余额 | 余额制 | 官方 API | API Key |
| Kimi (Moonshot) | Coding | 窗口制 | 官方接口 | API Key |
| opencode | Go Coding | 窗口制 | 官方 API | API Key |
| 智谱 bigmodel | GLM Coding Plan | 窗口制 | 官方 API | API Key |
| MiniMax | Token Plan | 窗口制（5h + 周窗） | 官方 API | Token Plan 订阅 Key（`sk-cp-` 前缀） |
| 阿里云百炼 | Token Plan | 窗口制 | 官方 CLI `bl` | 免填 Key，登录一次 |
| 火山方舟 | Coding Plan | 窗口制 | 官方 CLI `arkcli` | 免填 Key，SSO 登录一次 |
| 小米 MiMo | Token Plan | 窗口制 | 官方网页会话 | 免填 Key，应用内登录一次 |

> MiniMax（按量余额）、美团 LongCat、opencode zen 按量余额在规划中（见 docs/DESIGN.md §5.2）。
> 接新通道 = 通道目录声明式注册，映射零代码（标准接口）；复杂接口用 TS 适配器。

通道级前置：两个 CLI 通道需要额外装官方 CLI（首次添加实例时 app 内一键安装流程会给出指引），
小米 MiMo 免填 Key 走应用内会话登录，其余通道填 API Key 即用：

| 通道 | 额外依赖 | 授权方式（app 内一键） |
|------|---------|----------------------|
| 阿里云百炼 | `bl` CLI（首次添加实例时一键安装） | 卡上点「授权」→ 浏览器打开百炼控制台完成登录；CLI 会话由服务端时效控制（经验数天），过期后卡片转黄并提示重新授权 |
| 火山方舟 | `arkcli` CLI（首次添加实例时一键安装） | 卡上点「授权」→ 火山 SSO 设备码两段式浏览器验证；CLI 会话由服务端时效控制，过期后卡片转黄并提示重新授权（**火山 SSO 失效自助恢复路径，详见 [USER_GUIDE.md](docs/USER_GUIDE.md)**） |
| 小米 MiMo | 无（全程应用内） | 添加时点「授权登录」→ 弹出登录窗口内完成小米账号登录，app 自动截取会话（无需手抄 Cookie）；会话过期后卡片同样提示重新授权 |

> **CLI 通道已不再需要手动跑命令行**：v0.2.8 之前在终端执行 `bl auth login --console` 或 `arkcli auth login volc-sso --no-browser` 的步骤，现在统一由 app 内 OneClickAuth 面板代理；命令行兜底仅在 app 内面板异常时使用，详见 [USER_GUIDE.md §4](docs/USER_GUIDE.md)。

## 仓库结构

```text
token-wallet/
├── packages/
│   ├── core/             采集核心（纯 TS 库）：适配器注册表 / 调度器 / 缓存 / schema
│   ├── app/              Electron 桌面部件（React 19）：托盘 + 弹出面板 + 设置
│   └── mcp-server/       MCP 数据面 daemon（Python fastmcp，独立部署）
├── docs/                 USER_GUIDE / DESIGN（架构）/ DECISIONS（决策）/ RELEASE（发版手册）
├── verification/         真机视觉验收快照（人工验收基准）
├── sketches/             UI 视觉 mockup（评审用，可丢弃）
├── scripts/              Windows 构建脚本
├── start-dev.mjs         开发环境检查 + Electron 开发壳入口
└── package.json          pnpm workspace
```

## 安装

### 下载安装包（推荐）

当前版本 **v0.3.0**，稳定版直链（始终指向最新稳定版，发版自动更新）：

```text
https://gitee.com/ITEater/token-wallet/releases/download/stable/token-wallet_setup.exe
```

- Windows 10/11 x64，单文件全离线安装包（~90 MB，含完整 Chromium 运行时，无外部依赖；MCP 服务组件首次使用时一键下载）
- 平台说明：当前**官方支持 Windows**；macOS / Linux 的代码层已兼容（凭据走系统
  safeStorage，路径按平台派生），但未发布安装包、未经真机验收——见 [Roadmap](#roadmap)
- 校验：Release 附件中的 `SHA256SUMS.txt` 与安装包比对
- 首次安装：安装包未做代码签名，SmartScreen 提示「未知发布者」时点
  「更多信息」→「仍要运行」即可（预期行为，签名将在后续版本解决）
- 自动更新：v0.2.0+ 内置 `electron-updater` 自动更新（更新源 = gitee stable
  `https://gitee.com/ITEater/token-wallet/releases/download/stable/`），启动静默 check only；
  下载与安装始终用户点击触发，详见设置页「关于」区
- 升级保留：实例配置、settings、SQLite 快照全部保留（NSIS `deleteAppDataOnUninstall:false`
  + userData 目录稳定）。v0.2.0 之前的旧版本请先手动安装一次 v0.3.0，之后即走自动更新

### 从源码运行

前置依赖（任一形态都需要）：

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 22 | 运行 / 构建（pnpm 由 corepack 自动对齐） |
| pnpm | ≥ 9（corepack 自动） | 包管理 |
| Windows 10/11 x64 | — | 桌面部件运行平台 |

无需原生模块编译，无 Rust / Visual Studio / WebView2 工具链。

```bash
# 国内：gitee 主仓 ｜ 海外：GitHub 镜像 github.com/donald2008/token-wallet
git clone git@gitee.com:ITEater/token-wallet.git
cd token-wallet
corepack pnpm install                    # 装依赖（corepack 自动启用 pnpm 9.x）
corepack pnpm -C packages/core build      # 构建 core 包（输出 dist/，app 编译依赖）
node start-dev.mjs                       # 环境检查 → 起 Electron 开发壳
```

或手动分步：

```bash
corepack pnpm install                    # 装依赖
corepack pnpm -C packages/core build      # 构建 core dist
corepack pnpm dev                        # Electron 开发壳
corepack pnpm dev:web                    # 仅浏览器预览（无主进程 → 无钥匙串/SQLite；用于 e2e/UI 调试）
```

Windows 双击 `start-dev.cmd`；`node start-dev.mjs --check` 只做环境检查不起壳。

> [!WARNING]
> fresh clone 后必须先跑 `corepack pnpm -C packages/core build` 构建 core 的 dist/，
> 否则 app 的 typecheck 会因找不到 `@token-wallet/core/*` 而报错。

### 构建 Windows 安装包

```bash
corepack pnpm build:win    # = corepack pnpm -r build + corepack pnpm -C packages/app dist:win
```

产物在 `packages/app/release/token-wallet_<版本>_setup.exe`。打包链为纯 Node 工具链
（electron-builder），不需要 Rust / Visual Studio / WebView2 工具链；详细发版手册见
[RELEASE.md](RELEASE.md)（含 WSL2 出包时的 wine64 / npmmirror 镜像前置）。

> **MCP daemon 独立组件分发**（2026-09-30；起因 gitee release 附件 100MB 上限，daemon 出包瘦身）：
> `dist:win` 打包前自动构建 MCP daemon（`packages/mcp-server/deploy/build-exe.ps1`，PyInstaller
> onefile，前置 Windows 宿主 + Python ≥ 3.11 + pip 依赖自动补装），打包成功后复制为
> `release/token-wallet-mcp-win-x64.exe` 物料——**发布时上传 gitee stable（固定名，与 app 内
> 下载 URL 对齐）**；用户端由设置页「安装 MCP 服务」一键下载到 `<userData>/mcp/`（原子落位）。
> WSL2 侧出包时需先在 Windows 宿主跑一次该脚本产出
> `packages/app/resources/token-wallet-mcp.exe`（产物已 gitignore），或设
> `TW_SKIP_DAEMON_BUILD=1` 显式跳过（跳过后无发布物料，用户端一键安装将 404，不建议）。

## 快速上手

从打开到看见第一组数据，不超过三分钟 —— 全程在应用内完成，不需要命令行。

### 1. 添加你的第一个平台

点底部的「＋」按钮，在弹出的平台树中展开平台、点击产品直达配置表单，按接入类型完成配置：

| 接入类型 | 平台 | 操作步骤 |
|----------|------|----------|
| **填 Key 即用** | DeepSeek · Kimi · opencode · 智谱 GLM · MiniMax | 到平台控制台生成 API Key（MiniMax 取 `sk-cp-` 前缀的 Token Plan 订阅 Key）→ 粘贴 → 测试连接 → 保存实例 |
| **CLI 一键授权** | 阿里云百炼 · 火山方舟 | 添加时若提示 CLI 缺失，按面板指引一键安装；保存后卡片上点「授权」→ 浏览器自动打开完成登录（火山为 SSO 设备码两段式验证） |
| **会话登录** | 小米 MiMo | 点「授权登录」→ 弹出登录窗口内完成小米账号登录 —— app 自动截取会话，无需手动拷贝任何 Cookie |

每个实例保存后立即开始独立采集：第一份快照马上出数，之后按各自窗口节奏自动刷新。

### 2. 读懂面板

- **一张卡片 = 一个平台套餐**：进度条是当前窗口的用量；「预计可用约 N 天」按近期消耗速率外推（余额制）
- **颜色语义**：绿 = 充足 · 黄 = 需要关注（额度吃紧 / 凭据过期，卡片上有对应按钮）· 红 = 异常或耗尽 · 灰 = 未配置
- **悬停看明细**：停在卡片上看窗口明细；停在进度条上看剩余量与重置倒计时（额度最紧的窗口自动标红左缘）
- **拖动排序**：按住卡片拖动即可自定义顺序，松手一次持久化
- **主题**：标题栏 ☀ 钮快切浅色 / 深色 / 跟随系统；设置页可调玻璃透明度（半透明 + 背景模糊）

### 3. 接入你的 AI Agent（可选）

用 Hermes / Claude Code / opencode / Codex 等 Agent 跑任务时，把本机 token 消耗自动汇总进「Agent 用量」大屏：

1. 设置页 →「MCP 服务」→ 首次点「**安装 MCP 服务**」一键下载组件（约 30 MB，仅一次）；装好点「一键启动」
2. 点「复制引导链接」，把链接粘贴给你的 Agent —— Agent 打开后按文档自助完成接入与上报（认证 → 接口规格 → 示例 → 验证），无需手工配置
3. 之后每次 LLM 调用自动入库；切到主面板的「本地 Agent」tab，点顶部用量卡片（「打开用量大屏」）即看实时 tokens / 成本 / 缓存命中

### 4. 保持更新

v0.2.0+ 内置自动更新：启动时静默检查新版本，设置页「关于」区一键升级；实例配置与历史数据完整保留。

> 更完整的逐屏操作手册（含火山 SSO 失效自助恢复、托盘行为等）见 [docs/USER_GUIDE.md](docs/USER_GUIDE.md)。

## FAQ

**Q：SmartScreen 拦截安装？**
未签名的预期行为。「更多信息」→「仍要运行」。

**Q：API Key 从哪取？**

| 平台 | 获取位置 |
|------|----------|
| DeepSeek | platform.deepseek.com → API Keys |
| Kimi Coding | platform.moonshot.cn → 开放平台 → API Key（Coding 套餐） |
| opencode | opencode.ai → 账户 Settings → API Keys（zen/go 套餐） |
| 智谱 bigmodel | bigmodel.cn → API Keys（Coding Plan 套餐 key，与 coding 推理 key 是同一个） |
| MiniMax | platform.MiniMax.io → Token Plan 订阅管理（key 前缀 `sk-cp-`） |
| 小米 MiMo | 无需获取 —— 添加时点「授权登录」在弹窗内登录一次即可（app 自动截取会话） |

**Q：百炼 / 火山方舟怎么授权？为什么要装 CLI？**
两家平台的用量查询只认控制台登录会话（由官方 CLI `bl` / `arkcli` 自管），不接受 API Key。
**v0.2.8 起全 app 内操作**：添加实例时若 CLI 不在 PATH，一键安装按钮自动执行；
安装好后卡上点「授权」→ OneClickAuth 面板自动拉起浏览器完成登录（方舟走 SSO 设备码两段式验证）。**全程不碰命令行**。
CLI 会话由服务端控制时效（经验数天），过期后卡片转黄并显示「请重新授权」按钮，点击即自助恢复
（火山 SSO 失效自助恢复详见 [USER_GUIDE.md §4](docs/USER_GUIDE.md)）。小米 MiMo 同为 app 内操作：
添加时点「授权登录」在弹窗内完成小米账号登录即可，无需复制任何凭据。

**Q：面板显示黄色/红色卡片？**
黄 = 需要关注（额度偏低或凭据过期，卡片上有具体修复命令可一键复制，或直接点「请重新授权」按钮自助恢复）；
红 = 异常或额度耗尽；灰 = 未配置。把鼠标悬停在窗口进度条上可看各窗口剩余与重置时间。

**Q：我的 Key 和用量数据安全吗？**
Key 存 OS 钥匙串（Windows 凭据管理器 / macOS Keychain），配置文件只存引用不存明文；快照数据落本机
SQLite。应用无任何遥测/上报代码，网络请求只有你在设置页添加的通道对应官方端点。

> 卡片排序、玻璃主题、更新的具体操作见 [USER_GUIDE.md](docs/USER_GUIDE.md)。

## 文档

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — **用户实操手册**：clone → 添加 provider（填 Key / CLI 授权 / 会话登录三类）→ 看数据 → 设置，含火山 SSO 失效自助恢复
- [docs/DESIGN.md](docs/DESIGN.md) — 架构与设计（通道两层模型 / 适配器体系 / 调度 / UI）
- [docs/DECISIONS.md](docs/DECISIONS.md) — 决策记录（D-001 ~ D-059，每条附实测依据）
- [TESTING.md](TESTING.md) — 测试矩阵与跑法
- [RELEASE.md](RELEASE.md) — 发版手册

## Roadmap

### 近期

- MiniMax 按量余额通道（`sk-api-` key，query_balance 端点已探明）
- 火山方舟扩展：免费额度 / 媒资容量视角（usage balance 控制面命令）

### 中期

- MCP 数据面「云 × 本地」用量对比视角（mcp-server 数据面扩展）
- 美团 LongCat、opencode zen 按量余额通道

### 远期

- 代码签名（消除 SmartScreen 警告）、CI 自动化
- macOS / Linux 安装包：代码层已兼容（safeStorage / 路径派生），需要真机验收后发布

完整通道级规划见 [docs/DESIGN.md §5.2](docs/DESIGN.md)。

## License

[Apache License 2.0](LICENSE)
