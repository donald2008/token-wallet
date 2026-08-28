# token-wallet 发版手册

安装实施定案见 `docs/DESIGN.md` §10.1(D-031)。本文件是操作手册:谁、在哪、怎么发。

## 发版人

**Windows 本机**(唯一构建渠道)。Linux/WSL2 无可靠 cross,开发者日常维护代码即可,不需要构建环境。

## 前置环境(Windows 本机一次性准备)

| 依赖 | 用途 | 获取 |
|------|------|------|
| Node.js ≥ 20 + pnpm | 构建前端 + workspace | https://nodejs.org / `corepack enable` |
| Rust toolchain(MSVC target) | Tauri Rust 侧 | https://rustup.rs |
| WebView2 运行时 | Tauri 目标环境 | Win11 预装;Win10 通过安装包 bootstrapper 自动装 |
| NSIS | 安装包生成 | Tauri bundler 自动下载(需网络) |

装好后验证:

```powershell
pnpm --version
rustc --version   # 应含 (x86_64-pc-windows-msvc)
```

## 发版步骤

1. **确认代码就绪**: `git pull` 到最新 master,`pnpm install`。

2. **确认版本号**: 版本在 `packages/app/package.json`(`version` 字段)。
   遵循 semver。发版前更新:
   - `packages/app/package.json` version
   - `pnpm-lock.yaml`(`pnpm install` 自动同步)
   - 升级日志(如有 `CHANGELOG.md`)

3. **构建**:

   ```powershell
   cd packages/app
   pnpm tauri build
   ```

   产物位置:
   ```
   packages/app/src-tauri/target/release/bundle/nsis/*-setup.exe
   ```

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
   - 附件: NSIS 安装包 + SHA256 文本(文件名 `SHA256SUMS.txt`)

## 安装提示(每次发布描述里带上)

> **首次安装**: 当前版本未做代码签名,SmartScreen 会提示"未知发布者"。
> 点「更多信息」→「仍要运行」即可。这是预期行为(P4 前暂缓签名)。
> 校验: 安装包 SHA256 见 SHA256SUMS.txt。

## 更新策略

P0~P2 阶段**无自动更新**,更新 = 下载新版安装包重装(数据保留,安装路径不变)。

## P4 待办(发版自动化)

- [ ] 代码签名(EV/OV 证书,消除 SmartScreen 提醒)
- [ ] Tauri updater: ed25519 签名 key + 更新清单 JSON + 静态托管
- [ ] CI 自动化构建(gitee Actions / GitHub Actions,跑 L1+L2 测试)
- [ ] GitHub 镜像同步发版