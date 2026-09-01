# token-wallet

把各家 AI Coding Plan 的窗口配额与按量余额，收进一个一瞥可读的 Windows 桌面部件。

token-wallet 是一个零遥测、数据不出本机的开源桌面部件（Electron）：统一展示多云 AI
平台的窗口制配额（5 小时滚动窗 / 周窗 / 月窗）与按量余额，按近期消耗速率估算可用天数，
额度临近耗尽提前变色提醒 —— 别让正在跑的任务链死于额度悄悄耗尽。

| Dark | Light |
|------|-------|
| ![dark](docs/screenshots/panel-dark.png) | ![light](docs/screenshots/panel-light.png) |

## 解决什么问题

多 Agent 工作流下，token 消耗分散在多家 provider 的多类套餐里
（5 小时滚动窗 / 7 天窗 / 月度额度 / 按量余额）。任一平台额度悄悄耗尽，
正在执行的任务链就会中断。token-wallet 把所有套餐的剩余量、窗口重置倒计时、
消耗速率集中到一个桌面部件上，一瞥可读。

## 功能

- **六家平台内置通道**，填 Key（或登录一次官方 CLI）即用，无需任何配置文件
- **三种套餐原型**统一视图：窗口制（多窗进度条 + 重置倒计时）/ 余额制（余额 + 预计可用天数）/ 本地用量（规划中）
- 系统托盘常驻 + 360px 弹出面板，托盘色点 = 全局最差状态
- 卡片过滤（全部 / 可用 / 异常）+ 按平台筛选；名称 / 紧要度 / 拖拽手动三种排序
- 异常显式化：key 失效、CLI 缺失、接口变更都给明确卡片与修复指引，绝不显示假数据
- cache-first：快照落本地 SQLite，断网可看最后一次数据
- 凭据存 OS 钥匙串（Windows 凭据管理器），配置文件永不落密钥
- dark / light 主题，默认跟随系统
- 零遥测、零上报、数据不出本机（首开须同意隐私声明）

## 支持的通道

| 平台 | 产品 | 计费形态 | 接入方式 | 需要什么 |
|------|------|----------|----------|----------|
| DeepSeek | 按量余额 | 余额制 | 官方 API | API Key |
| Kimi（Moonshot） | Coding | 窗口制 | 官方接口 | API Key |
| opencode | Go Coding | 窗口制 | 官方 API | API Key |
| 智谱 bigmodel | GLM Coding Plan | 窗口制 | 官方 API | API Key |
| 阿里云百炼 | Token Plan | 窗口制 | 官方 CLI `bl` | 免填 Key，`bl auth login --console` 登录一次 |
| 火山方舟 | Coding Plan | 窗口制 | 官方 CLI `arkcli` | 免填 Key，SSO 设备码登录一次 |

> MiniMax、美团 LongCat、opencode zen 按量余额在规划中（见 docs/DESIGN.md §5.2）。
> 接新通道 = 通道目录声明式注册，映射零代码（标准接口）；复杂接口用 TS 适配器。

## 安装

### 下载安装包（推荐）

当前版本 **v0.2.0** 直链下载：

```
http://10.200.1.88:8889/token-wallet/token-wallet_0.2.0_setup.exe
```

- Windows 10/11 x64，单文件全离线安装包（~93 MB，含 Chromium 运行时，无外部依赖）
- 校验：同目录 `<同名>.exe.sha256`
- **首次安装**：安装包未做代码签名，SmartScreen 提示「未知发布者」时点
  「更多信息」→「仍要运行」即可（预期行为，签名在后续版本解决）
- **自动更新**：v0.2.0 起应用内置自动更新，之后无需再手动下载重装；
  当前 v0.1.x 更新 = 下载新安装包重装（配置与数据保留）

正式发布后安装包将挂 gitee release 页面，直链随之替换。

### 从源码运行

要求 Node.js ≥ 22（pnpm 由 corepack 自动对齐，无原生模块、无需任何 rebuild）：

```bash
git clone git@gitee.com:ITEater/token-wallet.git
cd token-wallet
node start-dev.mjs           # 环境检查 → 装依赖 → 起 Electron 开发壳
```

或手动分步：

```bash
pnpm install
pnpm dev        # Electron 开发壳
pnpm dev:web    # 仅浏览器预览（无主进程 → 无钥匙串/SQLite）
```

Windows 双击 `start-dev.cmd`；`node start-dev.mjs --check` 只做环境检查不起壳。

### 构建 Windows 安装包

```bash
pnpm build:win    # = pnpm -r build + electron-builder NSIS
```

产物在 `packages/app/release/token-wallet_<版本>_setup.exe`。打包链为纯 Node 工具链
（electron-builder），不需要 Rust / Visual Studio / WebView2 工具链；详细发版手册见
[RELEASE.md](RELEASE.md)。

## FAQ

**Q：SmartScreen 拦截安装？**
未签名的预期行为。「更多信息」→「仍要运行」。

**Q：API Key 从哪获取？**

| 平台 | 获取位置 |
|------|----------|
| DeepSeek | platform.deepseek.com → API Keys |
| Kimi Coding | platform.moonshot.cn → 开放平台 → API Key（Coding 套餐） |
| opencode | opencode.ai → 账户 Settings → API Keys（zen/go 套餐） |
| 智谱 bigmodel | bigmodel.cn → API Keys（Coding Plan 套餐 key，与 coding 推理 key 是同一个） |

**Q：百炼（bl）怎么授权？为什么要装 CLI？**
百炼的用量查询只认控制台登录会话（官方 CLI `bl` 自管），不接受 API Key。
app 添加百炼实例时会检测 `bl` 是否在 PATH，缺失时卡片会显示安装指引，
按指引安装官方 CLI 并重启应用；装好后执行 `bl auth login --console` 完成浏览器登录。
控制台会话由服务端控制时效（经验数天），过期后卡片转黄并提示重新登录。

**Q：火山方舟（arkcli）怎么授权？**
方舟用官方 CLI 的 SSO 设备码两段式登录：`arkcli auth login volc-sso --no-browser`，
按提示在浏览器完成验证。CLI 缺失时卡片会给出 `npm i -g @volcengine/ark-cli` 安装指引，
手动安装并重启应用即可。会话过期后卡片转黄并提示重新登录。

**Q：面板显示黄色/红色卡片？**
黄 = 需要关注（额度偏低或凭据过期，卡片上有具体修复命令可一键复制）；
红 = 异常或额度耗尽；灰 = 未配置。把鼠标悬停在窗口进度条上可看各窗口剩余与重置时间。

**Q：我的 Key 和用量数据安全吗？**
Key 存 OS 钥匙串（Windows 凭据管理器），配置文件只存引用不存明文；快照数据落本机
SQLite。应用无任何遥测/上报代码，网络请求只有你在设置页添加的通道对应官方端点。

## 文档

- [docs/DESIGN.md](docs/DESIGN.md) — 架构与设计（通道两层模型 / 适配器体系 / 调度 / UI）
- [docs/DECISIONS.md](docs/DECISIONS.md) — 决策记录（每条附实测依据）
- [TESTING.md](TESTING.md) — 测试矩阵与跑法
- [RELEASE.md](RELEASE.md) — 发版手册

## Roadmap

- 本地 Agent token 消耗视图 + 「云 × 本地」对比（MCP 数据面，规划中）
- 更多通道（MiniMax / 美团 LongCat / opencode zen 余额，见 docs/DESIGN.md §5.2）
- 代码签名、CI、GitHub 镜像
