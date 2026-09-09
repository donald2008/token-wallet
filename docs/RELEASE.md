# token-wallet 发版流程（D-046, 2026-09-01 改版；v0.2.8 沿用；D-054, 2026-09-02 起渠道走 gitee stable）

> 构建环境细节（前置依赖/一键脚本/WSL2 验证史）保留在文末 §A。
> 本文档主体是 **D-046 版本纪律 + D-054 开源稳定渠道下的标准发版流程**：版本 bump → build → 三件套上传 → gitee stable 必发 → tag → 验收。
> 自动更新机制：electron-updater generic 通道，更新源 = gitee stable
> `https://gitee.com/ITEater/token-wallet/releases/download/stable/`（一次定死，开源前后同 URL）。

> **当前里程碑 = v0.2.8**（版本基线 `89b6ae2`，本卡 docs 修订基线）：UI 全线重构 + 火山判别反转一键授权。
> 上述发版流程对 v0.2.x 系列均适用——版本号随 D-046 纪律随发随 bump。

## 1. 发版五步（每次发版照做，以 v0.2.0 为例；v0.2.8 同款）

### ① 版本 bump（与 tag 同号，D-046 纪律）
`packages/app/package.json` 的 `version` 改为本次版本号（如 `0.2.0` / `0.2.8`），commit 进 master。
**版本号必须与 git tag 同号**——latest.yml 与安装包文件名都由此生成，错位即更新链断裂。
版本 bump 是发版的**前置契约**：不开 PR 直接 bump + commit 进 master，违反此契约的产物一律驳回。

### ② 构建
Windows 本机（推荐，产出真机包）：
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```
WSL2 侧仅作构建链验证（`corepack pnpm -C packages/app dist:win`，需 wine64+i386 + npmmirror）。
⚠️ 出包前停 dev server（`dev:web` 与 `dist:win` 互斥）。

### ③ 三件套上传（缺一不可）
electron-builder 产出后 **gitee stable 是公共主渠道**（D-054, 2026-09-02 起一次定死，开源前后同 URL）：

| 产物 | 作用 |
|------|------|
| `token-wallet_<version>_setup.exe` | NSIS 安装包（更新链的完整包源） |
| `latest.yml` | 更新清单（版本号 + exe SHA512，**electron-updater 完整性校验依据**，build 时自动生成于 `packages/app/release/`） |
| `token-wallet_<version>_setup.exe.blockmap` | 差量块表（nginx Range 已实证 206 → 后续版本自动差量下载） |

**gitee stable 必发流程**（v0.2.4 起每次发版都做，缺一等于没发）：
1. **删旧 3 附件**：删稳定 release `token-wallet_setup.exe` / `latest.yml` / `token-wallet_setup.exe.blockmap`（Gitee API 上同一 stable release 只能保留一份）
2. **传新 3 件套**：删旧附件后用 Gitee Releases API **POST `https://gitee.com/api/v5/repos/ITEater/token-wallet/releases/<release_id>/attach_files`**（multipart/form-data，access_token 走 `-F "access_token=$TOKEN"` form 字段——Gitee API 不吃 Authorization header；`$TOKEN` 走 Consul `ai-hermes/security/integration/gitee-token`，仓主 token，发布机不可读，发布动作归仓主/老大侧人肉作业）；3 个附件分三次调用，每次返回 201 + attachment URL（即绑 release，POST 后可直接进 step3 匿名 curl 双校验）
3. **匿名 curl 验证**：`curl -sL https://gitee.com/ITEater/token-wallet/releases/download/stable/latest.yml | grep version`（确认 version == 新的） + `curl -sI .../token-wallet_setup.exe` 验 Content-Length 匹配 SHA256 文件声明；**匿名视角验证 = 用户下载路径已生效**（API 操作成功≠用户端已能下载，Gitee CDN 有缓存窗口）

**8889 内部开发通道**（可选辅助，非主渠道）：njbx02 nginx `http://10.200.1.88:8889/token-wallet/` 仅用于内部 smoke + 自动化测试，**不进公开文档 / 用户视野**（2026-09-01 用户硬纠正「开源 README 禁内网路径」）。

> **v0.2.5 假阳性教训**：仅 API 操作成功就宣告"已发版" → Gitee CDN 缓存未刷新 → 用户下载仍是旧版本 → 与 auto-update 检测新版本冲突 → 撤回重做。匿名 curl 验 latest.yml version + exe Content-Length 双校验是防此坑的唯一手段。

### ④ 打 tag（annotated，部署上线即打）
```bash
git tag -a v0.2.8 -m "token-wallet v0.2.8 (UI 全线重构 + 火山判别反转)" && git push origin v0.2.8
```
tag 前 = 线上基线，tag 后 = 开发态（monorepo 单应用暂不带前缀，若未来多应用再议）。

### ⑤ 验收
见 §3 清单。**v0.2.0 = 第一个内置自动更新版本**——v0.2.0+ 之间互相自动更新；v0.2.0 之前的版本需手动装一次。

## 2. 自动更新链路速查（D-046 + D-054）

- 启动静默 CHECK ONLY（`autoDownload=false`，只发现不下载）；设置页关于区四态：已是最新→检查更新钮 / 发现新版→「更新到 vX」/ 下载中 %→「重启安装 vX」，下载与安装永远用户点击触发
- 完整性 = latest.yml SHA512 内建校验；**不做代码签名**（SmartScreen 提示为预期）
- 更新源硬编码 `build.publish` = `https://gitee.com/ITEater/token-wallet/releases/download/stable/`（D-054, 9/2 起一次定死；publish.url 在 packages/app/package.json），**不做 UI 配置项**
- dev（`app.isPackaged=false`）三通道恒 `unavailable`，属预期
- **NSIS `deleteAppDataOnUninstall:false`** + userData 目录稳定 → 自动更新不丢实例数据

**全链自测捷径（无需出两个包）**：装好 vX 真包后，在托管目录放一份**假 latest.yml**（版本抬到 X.1，url/sha512 仍指向同一真 exe）→ 装好的 vX 应能 检测→下载→重启安装 → 验完删假 latest.yml。⚠️ 假清单期间真实用户也会看到假更新，自测窗口要短。

## 3. 真机验收清单（用户/老大，产品红线）

安装 → 首开 consent（一次）→ 添加 provider → 透明无边框观感 → **v0.2.8 新 UI 验收**：
- 360×720 紧凑面板，主页多实例按 P5MonitorShortSide 排版（5h+周同行两列、月全宽独立行）
- 玻璃主题：设置页「外观」区开关 + 透明度滑槽拖动实时预览（0-100%）
- 手动拖拽排序：长按卡 head 左侧 16px 品牌色块拖动，松手一次持久化
- 删钮：卡 head 右上常显但 hover 才激活热区，点击弹气泡二次确认
- 阿里云百炼 / 火山方舟：**app 内一键授权**（不再命令行）；火山 SSO 失效时卡上「请重新授权」按钮一键恢复（不再卡 stale）
- 自动更新链路（v0.2.0 → v0.2.x 走一次 检查/下载/重启安装 → 数据仍在）→ 卸载。

## 4. gitee stable 挂包（公共主渠道，D-054, 必做）

公共渠道 = gitee stable release，三件套必发流程见 §1③。本节是仓主/老大人肉作业的可选清单。

**8889 内部开发通道**（不进公开文档）：njbx02 nginx `http://10.200.1.88:8889/token-wallet/` 是内部 smoke + e2e 通道，build 卡（中台：855ab7c 起 dist-win 自动探测 GitHub 可达性 + 镜像注入）依赖此通道验证 Linux 出包链路；**不进公开 README / 用户视野**（2026-09-01 用户硬纠正「开源 README 禁内网路径」）。

## §A 构建环境（历史 E3 交接包，仍有效）

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | **≥ 22**（22.5+ 内置 node:sqlite） | winget install OpenJS.NodeJS.LTS |
| corepack | 随 Node 自带 | 脚本自动 `corepack prepare pnpm@9.15.0 --activate` |
| ~~Rust / VS Build Tools / WebView2~~ | 不需要 | D-033 Electron / D-034 零原生模块 |

一键脚本 `scripts/build-windows.ps1` 自动：探测仓库根 → 检测 Node/corepack → 注入大陆镜像
（ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR）→ git clone/pull → pnpm install（frozen-lockfile）→
pnpm -r build → electron-builder NSIS → 输出 SHA256。

手动等价：镜像 env → clone → `corepack prepare pnpm@9.15.0 --activate && pnpm install --frozen-lockfile` →
`pnpm -r build` → `pnpm -C packages/app dist:win` → 产物在 `packages/app/release/`。

**WSL2 侧已验证史（E3, 2026-08-29）**：NSIS Linux 原生产包成功（93.2MB）；asar 内容核验全在；
vite `base:"./"` 修复 file:// 白屏；生产模式 consent 冒烟通过；WSLg 不能注入点击，交互流归真机。
