# token-wallet 发版手册

安装实施定案见 `docs/DESIGN.md` §10.1(D-031)。本文件是操作手册:谁、在哪、怎么发。

> D-033(2026-08-29): 壳已换 Electron, 旧 Rust/Webview 壳打包链(WebView2/旧 bundler)
> 随之作废。**Electron 打包链(electron-builder/NSIS)已由 E3 落地(D-035)**, 构建命令见
> 发版步骤第 3 步; Linux 侧构建前提见下方"发版人"。

## 发版人

**Windows 本机为发版首选**(全量构建: 签名资源/图标嵌入行为以本机 ps1 为准);
**Linux/WSL2 亦可出包**(D-035 于 2026-08-30 实证放宽: electron-builder 打包链纯 Node,
njbx02 实测仅需 Node 22 + corepack + wine32, 见 docs/DESIGN.md D-035 补记),
真机验收仍必须在 Windows。开发者日常维护代码即可,不需要构建环境。

## 前置环境(Windows 本机一次性准备)

| 依赖 | 用途 | 获取 |
|------|------|------|
| Node.js ≥ 22 + pnpm | 构建前端 + workspace + Electron 打包 | https://nodejs.org / `corepack enable` |

Electron 自带 Chromium 运行时, 用户机器零额外依赖(告别 WebView2 运行时)。

装好后验证:

```powershell
pnpm --version   # 9.x
node --version   # >= 22
```

## 发版步骤

1. **确认代码就绪**: `git pull` 到最新 master,`pnpm install`。

2. **确认版本号**: 版本在 `packages/app/package.json`(`version` 字段)。
   遵循 semver。发版前更新:
   - `packages/app/package.json` version
   - `pnpm-lock.yaml`(`pnpm install` 自动同步)
   - 升级日志(如有 `CHANGELOG.md`)

3. **构建**(D-035 打包链):

   ```bash
   pnpm build:win    # = pnpm -r build + electron-builder NSIS
   ```

   产物: `packages/app/release/token-wallet_<版本>_setup.exe`(~93MB, 单文件全离线)。
   大小仅 ~174KB = 打包中断只出了 stub, 重跑。

4. **计算 SHA256**(发布校验):

   ```powershell
   Get-FileHash <产物>.exe -Algorithm SHA256
   ```

5. **打 tag + 推送**(发版习惯:部署上线即在 main 打 annotated tag):

   ```powershell
   git add -A
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "token-wallet vX.Y.Z"
   git push origin master --tags
   ```

6. **发布 gitee release**:
   - 打开 https://gitee.com/ITEater/token-wallet/releases → 新建 Release
   - Tag: `vX.Y.Z`
   - 标题: `vX.Y.Z`
   - 描述: 变更摘要 + **安装提示**(见下)
   - 附件: 安装包 + SHA256 文本(文件名 `SHA256SUMS.txt`)

## 安装提示(每次发布描述里带上)

> **首次安装**: 当前版本未做代码签名,SmartScreen 会提示"未知发布者"。
> 点「更多信息」→「仍要运行」即可。这是预期行为(P4 前暂缓签名)。
> 校验: 安装包 SHA256 见 SHA256SUMS.txt。

## 更新策略

P0~P2 阶段**无自动更新**,更新 = 下载新版安装包重装(数据保留,安装路径不变)。

## P4 待办(发版自动化)

- [ ] 代码签名(EV/OV 证书,消除 SmartScreen 提醒)
- [ ] 自动更新(Electron 生态: 签名 key + 更新清单 + 静态托管)
- [ ] CI 自动化构建(gitee Actions / GitHub Actions,跑 L1+L2 测试)
- [ ] GitHub 镜像同步发版
