# Plan: t_4bd214de — 设置页 MCP 服务区 + daemon 托管

**状态**：等老大拍板 4 个设计决策（下方 Q1-Q4），拍板后开干
**作者**：老三 (desktop-e5jupfs)
**基线**：`feat/theme-glass` HEAD `97dd79f`
**目标卡**：`t_4bd214de`

---

## 1. 范围（按卡体）

1. **设置页新增 [MCP 服务] 区块**（状态/启停/自启/key/引导），三主题不破
2. **daemon 托管逻辑**（main 进程 IPC：probe/start/stop/get-config/gen-key/set-autostart）
3. **引导页**：调 `GET /guide` 渲染各 agent 接入步骤
4. **测试**：单测 + e2e 可选

---

## 2. 数据契约（卡体已定稿，勿改）

`~/.config/token-wallet/mcp.env`：
```ini
TOKEN_WALLET_MCP_KEY=<随机 32 hex>
TOKEN_WALLET_PORT=9131
TOKEN_WALLET_HOST=127.0.0.1
TOKEN_WALLET_DB_PATH=~/.local/share/token-wallet/token-wallet.db
USAGE_TTL_DAYS=90
```

> Windows 路径用 `os.homedir()/.config`（D-019 同款主进程解析）。

---

## 3. 项目现状（已知事实）

- **项目 = Electron + React 19**（不是 Tauri），IPC = `window.tokenWallet.invoke` contextBridge
- 设置页 `packages/app/src/components/SettingsView.tsx`（350 行）已含 5 个 section + About
- **已有 IPC 模板**：`getLaunchAtLogin` / `setLaunchAtLogin`（走 `app.setLoginItemSettings`）+ `getStoragePaths`（用 `storagePaths()` 主进程解析）
- **e2e mock**：所有 IPC 在 `packages/app/e2e/fixtures.ts` 加 ipcMocks handler 即可（MCP 走同模板）
- **autostart 当前默认关**（D-024）— 卡体说 MCP 区块的 autostart **默认开**，需在 main.ts 加独立 key（MCP autostart ≠ app autostart）
- **无 daemon 进程可调度**：本卡只写 app 侧管理逻辑；daemon 真实体由 A 卡（t_2b9fa065，老二）实现 → 没 daemon 时 start 会失败，**测试靠 mock**

---

## 4. 文件改动计划

### 新增
| 路径 | 内容 |
|------|------|
| `packages/app/src/components/McpServicePanel.tsx` | 设置页 MCP 区块 UI（独立组件，便于单测隔离） |
| `packages/app/src/components/McpServicePanel.test.tsx` | 渲染 + 状态切换单测 |
| `packages/app/electron/mcp-env.ts` | 读写 `mcp.env`（parseINI / writeFile atomic）+ 32hex 生成 |
| `packages/app/electron/mcp-env.test.ts` | node vitest 直测 env 读写 + atomic 写 |
| `packages/app/electron/mcp-daemon.ts` | probe / start / stop / isInstalled 纯逻辑（无 electron 依赖，可单测） |
| `packages/app/electron/mcp-daemon.test.ts` | mock spawn → 测 probe/start/stop 流程 |
| `packages/app/src/components/AgentGuideModal.tsx` | 引导弹窗（portal to body，避 backdrop root 嵌套） |
| `packages/app/src/components/AgentGuideModal.test.tsx` | mock `GET /guide` 渲染 |
| `packages/app/e2e/mcp-service.spec.ts` | e2e 三态：未运行/运行中/key 复制 + 引导弹窗打开 |

### 修改
| 路径 | 改动 |
|------|------|
| `packages/app/src/ipc.ts` | 新增 `mcpProbe` / `mcpStart` / `mcpStop` / `mcpGetConfig` / `mcpGenKey` / `mcpSetAutostart` / `mcpOpenGuide` 包装层 + 浏览器降级 |
| `packages/app/electron/main.ts` | 7 个 IPC `ipcMain.handle` 注册 |
| `packages/app/electron/preload.ts` | 不动（统一 invoke 桥已通） |
| `packages/app/src/components/SettingsView.tsx` | 新增 `<McpServicePanel>` section 嵌入现有 settings-body |
| `packages/app/src/components/SettingsView.test.tsx` | 补 MCP 区块存在断言 |
| `packages/app/src/i18n.ts` | 新增 `set.mcp.*` 键位（zh 为主、en 对齐 `Dict = typeof zh` 强制） |
| `packages/app/src/app.css` | 增量添加 `.mcp-*` 样式块（不动既有 css，纯增量） |
| `packages/app/e2e/fixtures.ts` | 加 mcp 系列 ipcMock handler（mock probe/start/stop/get-config/gen-key/set-autostart） |
| `docs/DECISIONS.md` | 新增 D-048「MCP 服务设置页区块契约」 |
| `docs/DESIGN.md` | 章节追加（可选） |

> ⚠️ 兄弟卡 `t_4a8bc406` 正在并行做「大屏 mock」，卡体钉死「勿动 packages/mcp-server」 → 本卡零触碰 mcp-server ✓

---

## 5. 关键设计点（4 个需要老大拍板）

### Q1 — MCP 区块的 autostart 默认值 vs 现有 app autostart（D-024）的关系

卡体说「开机自启开关默认开」；项目里**已有的 `setLaunchAtLogin` / `getLaunchAtLogin` 默认关**（D-024，app 自身的「开机启动 token-wallet」）。

**两个候选**：
- **A. 两个独立开关**：MCP 区块有自己的「MCP 服务开机自启」（写 mcp.env + 注册 OS 启动项或拉起 token-wallet 时带参数）；app autostart 仍独立存在。**用户要管两个开关**，认知成本高。
- **B. 单一开关，MCP 默认开 + app autostart 联动开**：当 MCP autostart 打开时，自动把 app autostart 也打开（token-wallet 启动才能 spawn daemon）。这样只有一个开关，认知简单，但**和 D-024「默认关」抵触**。

**建议 B**（单一开关），但改 D-024 文档，说明「MCP 区块打开时 app 也跟着开自启」。

### Q2 — daemon spawn 路径 vs 未找到时的 UX

卡体说「先约定 `resources/token-wallet-mcp(.exe)`，本卡用可配置路径 + 未找到时提示」。

**两个候选**：
- **A. 固定 `resources/token-wallet-mcp`**：硬编码路径，UI 简单；dev 模式（`pnpm dev`）下永远找不到 → 一键启动永远灰着
- **B. 探测多个候选**：`resources/token-wallet-mcp` + `$PATH` + 用户可手动指定（设置页里加一个「Daemon 路径」可编辑字段）→ 灵活但 UI 多一栏

**建议 A + dev 下走 mcp-server mock fallback**：dev 模式（`app.isPackaged === false`）→ 用一个 `MCP_DEV_FAKE_PORT`（如 19131），让 probe 能成功 → 用户在开发时也能看到「运行中」态。打包后硬编码路径。

### Q3 — 32hex 随机 key 生成 + 「已配 agent 需更新 key」提示

卡体说「随机生成 = 生成 32 hex → 写 mcp.env → 提示『已配 agent 需更新 key』→ 重启 daemon 生效」。

**关键缺口**：daemon 在重启前会**用旧 key 处理请求**；已配 agent 用旧 key 调用会 401。是否在 stop/start 之间加一个「等待 2 秒 + 新一轮 probe 确认新 key 生效」？

**建议**：直接复用 mcp:stop + mcp:start，start 内置 polling-to-green（卡体已说），用户切完 key → 点「一键启动」即重启完成 → 弹 toast「已重启，旧 key 已失效」。

### Q4 — 引导页形态（弹窗 vs 浏览器）

卡体说「浏览器 or 内嵌，形态自定但必须能展示各 agent 接入步骤」。

**两个候选**：
- **A. 浏览器新开窗口**（`shell.openExternal`）：简单、零组件，但离开 app 失去主题一致性
- **B. 内嵌 React 弹窗**（portal 到 body，避 backdrop root 嵌套）：主题一致，体验完整，但需新组件

**建议 B**：本项目有 portal-modal 模式（t_c20d4d11 round-3 B3-2 实战），复用 createPortal。引导页内容简（agent 列表 + configure/verify 步骤），无状态。

---

## 6. 验收映射

| 卡体验收项 | 本计划落地 |
|-----------|-----------|
| 设置页 MCP 区块完整 + 三主题 | McpServicePanel + app.css 增量 + 三主题截图 |
| daemon 未跑 → 一键启动 → 状态变绿 | mcp:start spawn detached + polling-to-green |
| key 随机生成 + 提示更新已配 agent | mcp:gen-key + 弹 toast「已重启，旧 key 失效」 |
| 开机自启开关默认开、可关 | MCP 区块 autostart toggle（Q1 决议决定联动方式） |
| 引导页能打开 | AgentGuideModal portal + GET /guide mock（fixtures 返回 2 agent） |
| typecheck 0 / vitest 全绿 / e2e 全绿 | 全部串行复跑，落真实数字 |
| commit + push + ls-remote | 跟常规流程 |
| evidence 三态截图 + 测试数字 | dark/light/glass × 未运行/运行中/key 修改后 = 9 张（md5 互异） |

---

## 7. 不做

- ❌ 不实现 daemon 本体（A 卡 t_2b9fa065 老二）
- ❌ 不做 GET /guide 服务端（本卡 mock）
- ❌ 不实现 agent 适配器（C 卡老大）
- ❌ 不动 packages/mcp-server（兄弟卡 t_4a8bc406 并行中）

---

## 8. 风险

1. **mock IPC 的 fixtures.ts 序列化约束**：handler toString 进浏览器，闭包变量全丢 → 状态放 localStorage（D-038 同款，已有 keyring_* / http_get_json 范例）
2. **autostart 跨平台差异**：macOS 用 LaunchAgent（不是注册表 Run 键），需 `app.setLoginItemSettings({openAtLogin})`；Windows 注册表 Run 键 Electron 内部已包。**MCP 自启 vs app 自启分离**是关键（Q1 决议）
3. **dev 模式下找不到 daemon**：probe 永远红 → Q2 决议用 dev fake port fallback 兜底
4. **e2e 端口抢**（feat/theme-glass 高频坑）：1420/1421/1431/1441 都被兄弟 session 占过；本卡 e2e 用 1451（参照兄弟 t_433892c6 配方）

---

## 9. 老大拍板 4 个点（Q1-Q4）+ 拍板后立即开工

请回复 A/B 选择。**4 个都建议 B**（除 Q1 建议 B、C 走默认）。
