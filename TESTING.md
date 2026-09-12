# token-wallet 测试矩阵

测试流程定案见 `docs/DESIGN.md` §10.2(D-030)。本文件是操作手册:每层测什么、怎么跑、验收标准。

## 四层测试

| 层 | 测什么 | 工具 | 位置 | 自动化 |
|----|--------|------|------|--------|
| L1 单元 | core: schema/registry/credential/store/调度器 | vitest | 任何机 | ✅ 全自动 |
| L2 前端 E2E | app 交互全流程(mock 桌面桥 IPC) | Playwright browser 模式 | Linux/CI | ✅ 全自动 |
| L2.5 真壳视觉 | 真窗口几何/主题真渲染/互斥交互 | Playwright `_electron.launch`(D-030a) | Windows 本机 | ⚠️ 半自动(启动需本机, 断言全自动) |
| L3 真通道 | 真 API + 真余额 | 手动 + golden sample | 我们的机器 | ⚠️ 半自动 |
| L4 Windows 冒烟 | 安装/托盘/首开 | 手动 | Windows 本机 | ❌ 人肉 |

## L1 单元测试(packages/core)

```bash
pnpm --filter core test
```

覆盖(随 P0-1 落地):
- zod schema: 合法/非法快照校验
- ChannelRegistry: 注册/查找/两层模型(platform→product)
- CredentialSource: env/file/command 解析,store 接口
- SqliteStore: snapshots/usage_records 落库读回
- 调度器: 防重叠、超时硬切断、指数退避、auth_expired 停摆

验收: `vitest run` 全绿。**每条采集核心改动必须带测试,无测试 review 打回。**

## L2 前端 E2E(packages/app,Playwright browser 模式)

工具链(D-033 起): `@playwright/test` + 自家轻量 harness(`e2e/fixtures.ts`
注入 `window.tokenWallet` mock 桥, 与 Electron preload 同形态), 零额外测试依赖。
真壳 E2E(Electron)记 P2。

```bash
pnpm --filter app test:e2e          # browser-only project(headless Chromium)
```

覆盖:
- 首开向导: 隐私声明必须同意才能继续
- 设置页: 树形通道选择、动态表单、secret 不回显、实例增删、重复 name 拒绝
- 测试连接: 成功显示快照、失败显示错误
- 面板: bars/ticker 模板渲染、健康度排序、异常卡(不显示假数据)
- 主题: 深浅切换、双 token 语义

mock 约定: IPC 用 `ipcMocks` 拦截断言(`getCapturedInvokes`),前端逻辑全部真跑。

验收: `playwright test --project=browser-only` 全绿 + 截图留证。

## L2.5 真壳视觉验证(packages/app, Playwright _electron, t_2520e5f1)

L2(browser-only mock 桥 + 默认 1280 视口)与 L4(Windows 人肉)之间的自动化层:
`@playwright/test` 内置 `_electron.launch()` 驱动**真壳**(dist-electron/main.cjs),
在真实 BrowserWindow 几何下做断言 + 截图。三连返工(tab 不切换/窗口截断/主题色不生效)
全部是 browser-only 不触发、真壳才现形的缺陷 — 本层拦下它们, 人肉只留最终确认。

```bash
pnpm -C packages/app build                              # 前置: 出 dist-electron/main.cjs + dist/index.html
pnpm --filter app test:e2e --project=electron-shell     # Windows 本机执行
```

- **环境**: 仅 Windows 本机可跑(Linux xvfb 无边框透明窗口观感不可验, 见环境能力矩阵)。
  spec 内 platform 守卫: 非 win32 全部 `test.skip` 并输出说明, Linux/CI 照常全绿。
- **覆盖**(`e2e/shell-visual.spec.ts`):
  ① 真窗口启动 → 主面板渲染(视口 360×720 + panel 零横向溢出几何探针)
  ② 三主题(dark/light/glass)各一张截图 → `packages/app/verification/shell-visual/`
  ③ Agent 卡 → 大屏关键路径(mock 桥降级 + 真桥主进程开 900×640 独立窗两路径)
  ④ tab 互斥(切「本地 Agent」→ card-list/agent-card-section 卸载)
- **断言形态**: 几何探针(scrollWidth vs clientWidth、getBoundingClientRect、viewportSize)
  + computed style + 截图, 不依赖 vision(vision 判定由 reviewer/老大侧做)。
- **失败诊断**: console error / pageerror 全量收集 + 失败截图落 /tmp/shell-visual-fail/,
  不许静默。
- **IPC 数据**: 复用 L2 同一套 mock 桥(fixtures.ts 导出 ipcMocks)保证确定性;
  真桥路径用例不覆写 window.tokenWallet, 走 preload + 主进程真 IPC 验开窗。
- **证据落位**: `packages/app/verification/shell-visual/`(shell-dark/light/glass.png +
  shell-dashboard.png + shell-dashboard-standalone.png)。

## L3 真实通道验证(半自动)

敏感 key **永不落库、永不提交**。两种模式:

1. **golden sample(防接口变动,CI 可跑)**: 每个通道适配器带一份脱敏响应 fixture,
   断言 JSONPath 映射正确。接口变了 → golden 断言失败 → 及时感知上游变更。
2. **真 key 手动验证(我们的机器)**: 从 Consul secrets_mapping 读 key,跑一次采集脚本,
   肉眼核对真余额与映射结果。

通道实测基线(2026-08-27 已全部真数据验证):
- DeepSeek ¥451.86
- Kimi Code 84/100
- opencode Go 三窗(rolling/weekly/monthly)
- 方舟 Coding+Agent 四 SKU
- 阿里 bl 待 8/29 套餐重置后验证

## L4 Windows 冒烟(人肉清单)

Windows 本机执行,每次 P0 收口 + 每次发版前:

- [ ] 安装包可安装(NSIS, per-user)
- [ ] 托盘图标出现,色点状态正确(首开=灰)
- [ ] 点托盘弹出面板,窗口正常
- [ ] 首开向导: 隐私声明 → 添加 provider 全流程
- [ ] 深浅主题跟随系统
- [ ] 二次启动不重复开窗口(单实例锁)
- [ ] 卸载干净(数据目录按 D-019 分家,卸载不影响 ~/.config 配置)

结果反馈: 截图 + 文字回 kanban 验证卡。

## CI 规划

- P0~P2: worker 内测(每张卡自带 L1/L2,证据链 = 测试跑绿 + commit hash)
- P4: gitee Actions / GitHub Actions,Linux runner 跑 L1+L2 全自动