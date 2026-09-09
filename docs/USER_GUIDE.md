# token-wallet 用户手册

> **本手册是 v0.2.8 (2026-09-08) 的实操手册**：从零安装到日常使用到自助恢复，按时间顺序写清每一步。
> 工程级文档（架构/适配器/调度）见 [DESIGN.md](./DESIGN.md)；决策溯源见 [DECISIONS.md](./DECISIONS.md)。

---

## 1. 安装与首次启动

### 1.1 下载安装包（推荐 Windows 用户）

- 稳定版：[gitee Releases → stable](https://gitee.com/ITEater/token-wallet/releases/download/stable/token-wallet_setup.exe)

下载后双击 `.exe` 安装。

> **SmartScreen 提示「未知发布者」是预期行为**（v0.2.8 仍未做代码签名，签名在 P4）。
> 点「更多信息」→「仍要运行」即可。
> 校验：gitee Release 附件 `SHA256SUMS.txt` 与安装包 SHA256 对比。

### 1.2 从源码运行（开发者 / 跨平台用户）

**前置依赖**：

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 22 | 运行 / 构建 |
| pnpm | ≥ 9（corepack 自动） | 包管理 |
| 桌面环境 | Windows 10/11 / macOS / Linux 桌面 | 桌面部件运行平台 |

**最快路径**：

```bash
git clone git@gitee.com:ITEater/token-wallet.git
cd token-wallet
corepack pnpm install                    # 装依赖（corepack 自动启用 pnpm 9.x）
corepack pnpm -C packages/core build      # 构建 core（必须；app 编译依赖 dist/）
node start-dev.mjs                       # 环境检查 → 起 Electron 开发壳
```

**分步路径**：

```bash
corepack pnpm install
corepack pnpm -C packages/core build
corepack pnpm dev                        # Electron 真壳（钥匙串 + SQLite + IPC 全栈）
corepack pnpm dev:web                    # 仅浏览器预览（无主进程，调试 UI 用）
```

Windows 双击 `start-dev.cmd`；`node start-dev.mjs --check` 只做环境检查不起壳。

> ⚠️ **fresh clone 必跑** `corepack pnpm -C packages/core build`。
> 跳过会导致 `pnpm -C packages/app typecheck` 报一整墙 `@token-wallet/core/*` TS2307
> （即便本卡完全不动 core —— 因 `core/dist/` 没生成）。

### 1.3 首开页：同意隐私声明

应用启动后第一页是隐私声明（必读一次，因为：

- 我们**零遥测**、**零上报**、**数据不出本机**，所以必须让用户同意后才能启动采集；
- 你提交同意后写入 `~/.config/token-wallet/settings.json`（Windows 下为 `%APPDATA%\token-wallet\settings.json`）。

点「同意并继续」即进入主面板（首次是空态，提示你「添加第一个 provider」）。

---

## 2. 添加 Provider（首次配置）

### 2.1 选 HTTP 通道（DeepSeek / Kimi / opencode / 智谱 / MiniMax）

最简单：填一个 API Key 就完事。

1. 点面板底部「+ 添加」按钮（或空态页大按钮）
2. 选平台（树形目录 → 平台 → 产品，如「DeepSeek → 按量余额」）
3. 填表单：
   - 实例名称（默认「DeepSeek-按量余额 #1」；同产品可多实例，按名区分）
   - API Key（粘贴从对应平台控制台取的 Key）
4. 点「测试连接」→ 看到「连接成功 + 余额 XX.XX 元」即说明采集就绪
5. 点「保存」→ 实例出现在主面板，开始按 T2 档 5 分钟周期轮询

### 2.2 选 CLI 通道（阿里云百炼 / 火山方舟）

CLI 通道**不需要填 Key**，但需要装官方 CLI + 在 app 内完成一次授权。
**v0.2.8 起整个流程都在 app 内，不再需要手动跑命令行**（详见 §4）。

1. 点「+ 添加」→ 选「阿里云百炼 → Token Plan」或「火山方舟 → Coding Plan」
2. 填实例名称（Key 字段留空即可）
3. 点「测试连接」→ 第一次会触发 CLI 安装 + 引导授权：
   - 若 `bl` / `arkcli` 不在 PATH：卡上显示「一键安装」按钮，点击后自动装（过程 stdout 实时流入 log 抽屉，D-023）
   - 装好后再次点「测试连接」→ 弹出 OneClickAuth 面板，自动打开浏览器
   - 浏览器完成登录 / SSO 验证 → 回 app 点「我已完成」→ 实例开始采集

> **首次安装后的体验变化**：v0.2.8 之前文档会教你 `bl auth login --console` 或
> `arkcli auth login volc-sso --no-browser` 跑命令行。**这条命令不再需要**——所有流程由 app 内面板代理。
> 命令行兜底仅在 app 内面板异常时使用（见 §4.3）。

### 2.3 多实例与命名

- 同产品可加多个实例（不同账号或不同 key）；实例名称全局唯一
- 默认自动编号「平台-产品 #1 / #2」，建议手动改成易识别名（如「公司账号 / 个人账号」）
- 同 key 加多个实例会被拦截（D-043 key 去重，DynamicForm 提交前内联报错）

---

## 3. 看数据（日常使用）

### 3.1 主面板布局

360×720 紧凑面板，三段结构：

```text
  ┌─────────────────────────────────────────────────┐
  │  TitleBar:  app-title  [⟳] [theme] [📌] [—] [×] │  ← D-038 五钮常显
  ├─────────────────────────────────────────────────┤
  │                                                  │
  │  ┌──────────────┐  ┌──────────────┐             │
  │  │ DeepSeek     │  │ Kimi         │  ← P5 主页短窗并排
  │  │ 余额 XX.XX 元 │  │ 5h  60% 周40%│             │
  │  └──────────────┘  └──────────────┘             │
  │  ┌─────────────────────────────────┐            │
  │  │ 阿里云百炼 (授权中/异常/正常)    │  ← 异常卡独占行
  │  └─────────────────────────────────┘            │
  │  [filter ◇ ✓ ⚠]  ← 过滤 icon 浮卡片右上         │
  │                                                  │
  ├─────────────────────────────────────────────────┤
  │  BottomBar:  [＋添加]              [⚙ 设置]     │  ← 标题栏旧位改为底栏
  └─────────────────────────────────────────────────┘
```

**多窗口产品的排版**（P5MonitorShortSide，D-049）：
- 5h 窗 + 周窗：**同一行两列**（约 144px/列）
- 月窗：**全宽独立行**

**排版变体**（按窗口宽度自适应）：
- `row`（默认）→ 进度条横铺
- `duo` → 两个窗口并排
- `hero` → 大数字 + 单条进度
- `micro` → **百分比常驻直显**（适合极窄容器，v0.2.8 起可选）
- `ticker` → 滚动展示多窗

### 3.2 颜色语义

| 颜色 | 含义 | 处置 |
|------|------|------|
| 绿（ok） | 健康 | 无需任何操作 |
| 黄（warn） | 关注（30% 阈值；或 auth_expired / 凭据过期） | 看卡上提示，可能点「请重新授权」按钮一键恢复 |
| 红（bad） | 异常或耗尽（10% 阈值；或 error / key 失效） | 看卡上错误修复指引 |
| 灰（unknown） | 未配置 / 采集未启动 | 添加实例或等待采集完成 |

### 3.3 过滤与手动排序

**过滤**（卡片列表右上角 icon 钮组，D-048）：
- ◇ 全部（默认）
- ✓ 可用（health=ok 的实例）
- ⚠ 异常（health=bad / auth_expired / error）

**手动排序**（D-039 + t_d086543b，**v0.2.8 起唯一排序方式**）：
1. 长按卡 head 左侧 16px 品牌色块（光标变 grab）
2. 拖动卡片浮起，其他卡片让位显示落点指示线
3. 松手时**恰一次持久化**到 settings.json

> 旧的「名称 / 紧要度」自动排序已废弃。settings.json 里残留旧配置会自动归一为 `manual`，
> `order` 数组保留（你的拖拽顺序不丢）。

### 3.4 删实例

卡 head 右上角的「×」删钮**常显**但**hover 才激活热区**（D-051，t_433892c6 五轮收敛）。
点击弹出确认气泡 → 二次确认 → 删除实例 + 同步删 OS 钥匙串条目 + SQLite 快照保留（不删历史）。

---

## 4. 自助恢复路径（CLI 通道失效时）

### 4.1 百炼（bl）会话过期

**症状**：百炼实例卡片转黄，显示「请重新授权」按钮。

**处置**（全程在 app 内）：
1. 卡上点「请重新授权」→ OneClickAuth 面板自动打开百炼控制台
2. 浏览器完成登录 → 回 app 点「我已完成」
3. 采集自动恢复，卡片转绿

> **背后机制（D-041）**：CLI 会话由服务端时效控制，经验数天。session 过期触发 stderr body 判别
> `No console access token found` / `not logged in or has expired` → auth_expired 走一键授权。

### 4.2 火山方舟（arkcli）SSO 失效

**症状**：火山方舟实例卡片转黄；或显示「请重新授权」按钮；或看似「采集在跑但永远 stale」。

**为什么「看似 stale」其实是 SSO 失效**（D-052，t_f261dadb 用户 9/8 拍板）：
- arkcli 在 STS 续期撞锁时输出 body 含 `please run arkcli auth login` /
  `requires Volcengine Ark SSO STS` 等引导文案
- **早期版本**判 stale（重试绕过），但**实测重试永远不会自愈**（方舟 SSO token 已被服务端吊销/失效）
- **v0.2.8 起**统一判 `auth_expired` → 显示「请重新授权」按钮 → 用户可见一键恢复路径
- **不再判 stale**（删除 stale 分支）

**处置**（全程在 app 内）：
1. 卡上点「请重新授权」→ OneClickAuth 面板自动打开浏览器
2. 浏览器完成火山 SSO 设备码验证（按提示输入账号或扫码）
4. 回 app 点「我已完成」→ 采集自动恢复，卡片转绿

> **不要再去终端跑** `arkcli auth login volc-sso --no-browser` —— OneClickAuth 面板代理的就是这个流程，
> 且面板会自动重启进程让新 token 生效。终端操作反而可能因为进程冲突出问题。

### 4.3 命令行兜底（仅 app 内面板异常时）

如果 OneClickAuth 面板打不开浏览器 / 浏览器 OAuth 回调未触发采集恢复：
1. 关闭 app
2. 手动跑对应命令：
   ```bash
   # 百炼
   bl auth login --console
   
   # 火山方舟
   arkcli auth login volc-sso --no-browser
   ```
3. 浏览器完成登录 / SSO
4. 重启 app → 采集应自动恢复

### 4.4 Key 失效（HTTP 通道）

**症状**：DeepSeek / 智谱等 HTTP 实例卡片转红，显示「Key 无效，请更换」。

**处置**：
1. 卡上点「更换 Key」→ 直接进入编辑模式
2. 粘贴新 Key → 测试连接 → 保存

> Key 仍走 OS 钥匙串，配置文件只存引用。

---

## 5. 设置（偏好调整）

设置页（BottomBar 右下 ⚙）入口，常驻段：

### 5.1 外观

| 控件 | 作用 |
|------|------|
| 主题分段控件（dark / light / glass） | 切换主主题；玻璃主题让面板半透明浮在桌面 |
| 透明度滑槽（0-100%，**仅 glass 主题可见**） | 拖即变停即存；15% / 50% 是常用档 |

### 5.2 语言

分段控件（简体中文 / English），切换即时生效，重启保持（D-047）。

### 5.3 排序

v0.2.8 起排序设置区**只剩手动**提示文案，无三档切换 UI。
所有排序操作通过 §3.3 拖拽完成。

### 5.4 自启与存储路径

- 开机自启开关（默认关；D-024）
- 存储路径显示（不可点击；用于定位 SQLite / settings.json）

### 5.5 关于

- 当前版本（来自 `get_bootstrap`）
- 检查更新 / 更新到 vX / 正在下载 N% / 重启安装 vX 四态显式（D-046）
- gitee 主仓链接（报告 bug）

---

## 6. 故障排查速查

| 现象 | 可能原因 | 处置 |
|------|----------|------|
| SmartScreen 拦截 | 未签名（D-031） | 「更多信息」→「仍要运行」 |
| 应用启动后空白 | 首次开 consent 未同意 | 重新启动应用 |
| 卡上「Key 无效」 | Key 输错或被平台吊销 | 「更换 Key」流程 |
| 火山卡一直转圈 | SSO token 过期 | 卡上「请重新授权」一键恢复 |
| 玻璃主题开启后看不清文字 | 透明度滑到 0~20% | 拖回 50%+ 或关玻璃主题 |
| 自动更新卡在「正在下载」 | 网络问题 | 关 app 重开会重试；下载进度持久化 |
| 中文界面乱码 | 系统区域设置 | 设置页「语言」显式切回「简体中文」 |
| 拖拽排序无反应 | 卡 head 不在品牌色块上 | 拖卡 head 左侧 16px 块（光标变 grab 即可） |
| e2e 测试本机跑不起来 | 详依赖没装 | `corepack pnpm -C packages/app exec playwright install chromium` |
| dev server 起不来 :1420 | 端口占用 | `lsof -i:1420` 查谁占，杀掉 |

---

## 7. 升级路径

### 7.1 v0.2.0+ 自动更新

1. 设置页 → 关于 → 「检查更新」
2. 看到「更新到 vX.Y.Z」按钮 → 点击下载
3. 下载完成 → 看到「重启安装 vX」按钮 → 点击
4. 应用自动退出、安装新版本、启动
5. 实例、settings、SQLite 快照全部保留（NSIS `deleteAppDataOnUninstall:false`）

### 7.2 旧版本（< v0.2.0）手动升级

v0.2.0 之前无自动更新。手动下载 v0.2.8 安装包覆盖安装一次，之后即自动更新。

---

## 8. 数据与隐私

| 数据 | 存储位置 | 加密 |
|------|----------|------|
| API Key | OS 钥匙串（Windows 凭据管理器 / macOS Keychain） | 操作系统级 |
| 实例配置（不含 Key） | `%APPDATA%/token-wallet/instances.yaml`（YAML 配置） | 明文 |
| 用户设置 | `%APPDATA%/token-wallet/settings.json` | 明文 |
| 用量快照 | `%LOCALAPPDATA%/token-wallet/token-wallet.db`（SQLite） | 明文（仅本地） |

**零遥测**：应用无任何上报代码；网络请求只发到你在设置页添加的通道对应官方端点；
日志统一脱敏（Key 只在请求构造瞬间活在内存，立刻销毁）。