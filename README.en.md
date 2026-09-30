<div align="center">

# 💳 token-wallet

**All your AI quota, at a glance.** Don't let a three-hour task chain die because one platform's quota silently ran out.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React%2019-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Platforms 7](https://img.shields.io/badge/Platforms-8-6E56CF)](#supported-channels)
[![gitee primary](https://img.shields.io/badge/gitee-ITEater%2Ftoken--wallet-C71D23?logo=gitee&logoColor=white)](https://gitee.com/ITEater/token-wallet)
[![中文](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-blue)](README.md)

**DeepSeek · Kimi · opencode · Zhipu GLM · MiniMax · Alibaba Bailian · Volcengine Ark · Xiaomi MiMo** —
quota windows from eight AI platforms in a single 360×720px desktop widget: progress bars, reset
countdowns, and "days remaining" estimated from your consumption rate.

> **The silent bomb of the multi-agent era**: token spend is scattered across plans — 5-hour
> rolling windows, weekly windows, monthly windows, prepaid balances. Your long-running job
> dies at 3 a.m. and you only find out after digging through terminals: one platform's quota
> ran out two hours ago. **token-wallet deletes this failure mode from your workflow.**

| Dark | Light | Glass |
|------|-------|-------|
| ![dark](docs/screenshots/panel-dark.png) | ![light](docs/screenshots/panel-light.png) | ![glass](docs/screenshots/panel-glass.png) |

**Local Agent usage dashboard** (live token spend / cost / cache hit — Dark / Light / Glass,
data collected automatically by the MCP data plane, see [below](#local-agent-usage-collection-mcp-data-plane)):

| Dashboard Dark | Dashboard Light | Dashboard Glass |
|------|------|------|
| ![dashboard dark](docs/screenshots/dashboard-dark.png) | ![dashboard light](docs/screenshots/dashboard-light.png) | ![dashboard glass](docs/screenshots/dashboard-glass.png) |

**Paste a key and go · One-click authorize in app (CLI / session login) · Zero telemetry · Data never leaves your machine**

[![Download Windows installer](https://img.shields.io/badge/Download-Windows_installer-6E56CF?logo=windows&logoColor=white)](https://gitee.com/ITEater/token-wallet/releases/download/stable/token-wallet_setup.exe)

</div>

## What problem it solves

In multi-agent workflows, token consumption is spread across multiple providers and plan
types (5-hour rolling / 7-day / monthly / prepaid balance). When any platform quietly runs
dry, running task chains break. token-wallet consolidates remaining quota, window reset
countdowns, and consumption rates into one desktop widget — readable at a glance.

## Architecture

```text
  ┌────────────────────────────────────────────────┐
  │             Electron desktop widget (app)      │
  │  Popup panel 360×720 (React 19) · Settings ·   │
  │                  Add wizard                    │
  └───────────────┬────────────────────────────────┘
                  │ read-only local cache (cache-first, offline OK)
  ┌───────────────▼────────────────────────────────┐
  │              StorageBackend (SQLite)            │
  │  history snapshots → consumption rate / days    │
  └───────────────▲────────────────────────────────┘
                  │ background polling (per-instance scheduler)
  ┌───────────────┴────────────────────────────────┐
  │           Adapter layer (core)                  │
  │  http direct (DeepSeek/Kimi/opencode/Zhipu)     │
  │  command CLI wrappers (Bailian bl / Ark arkcli) │
  └────────────────────────────────────────────────┘
```

- UI always renders from local cache: numbers on launch, zero network wait, offline-capable
- Per-instance independent polling: concurrency, fault isolation, hard timeout, exponential backoff
- Explicit failures: invalid key / missing CLI / expired session → card shows a concrete fix
- Credentials in OS keychain; config files store references only (see docs/DESIGN.md)

## Features

- **Eight platforms on one screen**: window-based (multi-window progress bars + reset countdowns) and balance-based (balance + estimated days left) plans in a unified view
- **Early warning, not after-the-fact errors**: "days remaining" extrapolated from recent consumption rate; cards change color before quota runs dry
- **Failures are explicit**: invalid key / missing CLI / expired session — the card tells you how to fix it or offers a one-click "re-authorize" button, never fake data
- **Paste a key and go — CLI / session auth included**: HTTP channels take an API key; Bailian / Volcengine Ark install their official CLI and authorize via browser, all in-app; Xiaomi MiMo logs in once in-app and the session is captured automatically (no cookie copying)
- **Three themes + glass transparency**: dark / light / glass, follow the system or pick manually; the glass slider previews live and persists on release
- **Drag-to-reorder**: drag a card to take over ordering; persists exactly once on drop
- **Data stays on your machine**: zero telemetry, credentials in the OS keychain, snapshots in local SQLite, last-known data readable offline

## Local Agent usage collection (MCP data plane)

The "Local Agent usage dashboard" in the desktop widget is not fed by hand — it is collected
automatically by the **MCP data plane**. When you run multiple AI agents (Hermes / Claude Code /
opencode / Codex, etc.), their token spend and cost flow into a standard MCP interface automatically
and surface as a dashboard in the desktop widget; the same data plane is open for programmatic
self-querying by agents.

**How it works**:

- **Agent side (hook plugin)**: hooks into the agent harness's LLM call points, extracts usage on
  every call and reports it in batches (offline queuing, idempotent retries, zero blocking); any
  agent can self-onboard following the `/guide` standard
- **Data plane (daemon)**: a 7×24 resident MCP server at `http://127.0.0.1:9131/mcp` (streamable-http,
  Bearer auth); collection and querying keep running when the desktop app is closed
- **Desktop app**: automatically switches to the daemon's display panel once detected, no extra setup

**MCP tool surface (v1, three tools)**:

| Tool | Direction | Purpose |
|------|-----------|---------|
| `report_usage` | write | Agents hook-report LLM usage in batches (event_id idempotency + content fingerprint, safe retries) |
| `usage_summary` | read | Filter and aggregate by time window / agent / provider / model; costs back-filled via a built-in price table |
| `usage_report_echo` | read | Read back raw reports for reconciliation and acceptance |

**Deployment & configuration (one-click in the app)**:

The installer bundles the daemon (Python fastmcp sidecar) — no separate Python setup needed.
After installing the app:

1. The "**MCP Service**" panel in Settings: status at a glance (running / stopped); tap "**Start**"
   to bring it up at `127.0.0.1:9131/mcp`
2. "**Launch at login**" toggle: the daemon starts with your system, independent of the desktop app
3. **API key fully managed for you**: the app generates a random key into `mcp.env`
   (Linux/macOS `~/.config/token-wallet/mcp.env`, Windows `%APPDATA%\token-wallet\mcp.env`);
   copy it from the panel; after "regenerate", restart the daemon when prompted
4. **Agent onboarding**: click "**Copy guide link**" in the panel and send the link to your
   agent — it opens the `/guide` self-service standard (five sections: overview → auth →
   API spec → real example → verification) and completes the MCP client integration and
   usage reporting on its own, no per-harness manual setup required;
   the Hermes official implementation lives at [hook-usage-reporter](packages/hook-usage-reporter/) (reference)
5. After upgrading the app, a leftover old daemon process is detected and the panel offers
   a one-click restart

Configuration (`mcp.env`, normally no hand-editing needed):

| Variable | Default | Purpose |
|----------|---------|---------|
| `TOKEN_WALLET_MCP_KEY` | auto-generated by the app | Bearer auth key (required even for local requests) |
| `TOKEN_WALLET_PORT` | `9131` | daemon listen port |
| `USAGE_TTL_DAYS` | `90` | detail retention days (daily aggregation into long-term trends; aggregates are kept forever) |

**Headless environments** (servers): manual deployment (venv + systemd user service) in
[mcp-server/README](packages/mcp-server/README.md); same configuration variables.
Protocol spec: [docs/mcp-protocol.md](docs/mcp-protocol.md)
(AgentUsageReport v1 / dedup / TTL / auth).

## Supported channels

| Platform | Product | Billing type | Access | What you need |
|----------|---------|--------------|--------|---------------|
| DeepSeek | Pay-as-you-go | Balance | Official API | API Key |
| Kimi (Moonshot) | Coding | Window | Official API | API Key |
| opencode | Go Coding | Window | Official API | API Key |
| Zhipu bigmodel | GLM Coding Plan | Window | Official API | API Key |
| MiniMax | Token Plan | Window (5h + weekly) | Official API | Token Plan key (`sk-cp-` prefix) |
| Alibaba Bailian | Token Plan | Window | Official CLI `bl` | No key; log in once |
| Volcengine Ark | Coding Plan | Window | Official CLI `arkcli` | No key; SSO once |
| Xiaomi MiMo | Token Plan | Window | Official web session | No key; log in once in-app |

> MiniMax (pay-as-you-go), Meituan LongCat, opencode zen balance are planned (docs/DESIGN.md §5.2).
> Adding a channel = registering a declarative mapping in the channel registry, zero code
> for standard APIs; complex APIs use a TS adapter.

Channel-level prerequisites: the two CLI channels need the official CLI installed (a one
in-app install button handles it when missing the first time); Xiaomi MiMo needs no key —
a one-time in-app session login; all other channels work with an API key:

| Channel | Extra dependency | Authorization (in-app one-click) |
|---------|-----------------|----------------------------------|
| Alibaba Bailian | `bl` CLI (one-click install in app) | Tap "Authorize" on the card → opens the Bailian console for browser login; CLI sessions are server-side time-limited (empirically a few days); expired sessions turn the card yellow and prompt re-authorize |
| Volcengine Ark | `arkcli` CLI (one-click install in app) | Tap "Authorize" on the card → SSO device-code browser verification; CLI sessions are server-side time-limited; expired sessions turn the card yellow and prompt re-authorize (**Volcengine SSO self-heal, see [USER_GUIDE.md](docs/USER_GUIDE.md)**) |
| Xiaomi MiMo | None (fully in-app) | Tap "Authorize" when adding → complete the Xiaomi account login in the popup window; the app captures the session automatically (no cookie copying); expired sessions prompt re-authorize on the card |

> **CLI channels no longer require the command line**: pre-v0.2.8 you had to run `bl auth login --console` or
> `arkcli auth login volc-sso --no-browser` in a terminal. Since v0.2.8 the OneClickAuth panel in the app handles
> it; the command line is a fallback only when the in-app panel fails. See [USER_GUIDE.md §4](docs/USER_GUIDE.md).

## Repository layout

```text
token-wallet/
├── packages/
│   ├── core/             collection core (pure TS lib): adapter registry / scheduler / cache / schema
│   ├── app/              Electron desktop widget (React 19): tray + popup + settings
│   └── mcp-server/       MCP data-plane daemon (Python fastmcp, standalone deployment)
├── docs/                 USER_GUIDE / DESIGN (architecture) / DECISIONS / RELEASE (release manual)
├── verification/         real-machine visual acceptance snapshots (manual QA baseline)
├── sketches/             UI visual mockups (for review, can be discarded)
├── scripts/              Windows build scripts
├── start-dev.mjs         dev env check + Electron dev shell entry
└── package.json          pnpm workspace
```

## Install

### Download the installer (recommended)

Current version **v0.2.9**, stable link (always points to the latest stable release, updated on every release):

```text
https://gitee.com/ITEater/token-wallet/releases/download/stable/token-wallet_setup.exe
```

- Windows 10/11 x64; single-file fully-offline installer (~120 MB, bundles the Chromium runtime and the built-in MCP daemon, no external dependencies)
- Platform note: **officially supported on Windows** today. macOS / Linux are code-ready
  (credentials via system safeStorage, platform-derived paths) but no installers are
  published and no real-machine validation has been done — see [Roadmap](#roadmap)
- Verify: compare the installer against `SHA256SUMS.txt` in the Release assets
- First install: the installer is not code-signed; when SmartScreen says "Unknown publisher",
  click "More info" → "Run anyway" (expected behavior; signing is planned)
- Auto-update: built-in `electron-updater` since v0.2.0 (update source = gitee stable
  `https://gitee.com/ITEater/token-wallet/releases/download/stable/`); startup does a silent
  check-only; download and install are always user-triggered; see Settings → About
- Upgrades preserve everything: instances, settings, SQLite snapshots are kept
  (NSIS `deleteAppDataOnUninstall:false` + stable userData directory). On a pre-v0.2.0
  version, install v0.2.9 manually once, then auto-update takes over

### Run from source

Prerequisites (any form needs these):

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | ≥ 22 | run / build (pnpm aligned via corepack) |
| pnpm | ≥ 9 (auto via corepack) | package manager |
| Windows 10/11 x64 | — | desktop widget platform |

No native module compilation; no Rust / Visual Studio / WebView2 toolchains.

```bash
# CN: primary repo on gitee ｜ overseas: GitHub mirror github.com/donald2008/token-wallet
git clone git@gitee.com:ITEater/token-wallet.git
cd token-wallet
corepack pnpm install                    # install deps (corepack auto-enables pnpm 9.x)
corepack pnpm -C packages/core build      # build core (output dist/, required by app compilation)
node start-dev.mjs                       # env check → launch Electron dev shell
```

Or step by step:

```bash
corepack pnpm install                    # install deps
corepack pnpm -C packages/core build      # build core dist
corepack pnpm dev                        # Electron dev shell
corepack pnpm dev:web                    # browser preview only (no main process → no keychain/SQLite; for e2e/UI debug)
```

On Windows double-click `start-dev.cmd`; `node start-dev.mjs --check` only checks the environment.

> [!WARNING]
> After a fresh clone you must run `corepack pnpm -C packages/core build` first,
> otherwise the app typecheck fails to resolve `@token-wallet/core/*` because `core/dist/` is missing.

### Build the Windows installer

```bash
corepack pnpm build:win    # = corepack pnpm -r build + corepack pnpm -C packages/app dist:win
```

Output: `packages/app/release/token-wallet_<version>_setup.exe`. The packaging chain is
pure Node tooling (electron-builder) — no Rust / Visual Studio / WebView2 needed; see
[RELEASE.md](RELEASE.md) for the full release manual (incl. WSL2 prereqs: wine64 + npmmirror).

> **MCP daemon sidecar bundled with the installer** (lite-01): `dist:win` builds the MCP
> daemon automatically before packaging (`packages/mcp-server/deploy/build-exe.ps1`,
> PyInstaller onefile; requires a Windows host + Python ≥ 3.11, pip deps auto-installed)
> and bundles it into the installer — the Settings "MCP Service" panel works out of the box.
> When packaging from WSL2, first run that script once on the Windows host to produce
> `packages/app/resources/token-wallet-mcp.exe` (gitignored), or set
> `TW_SKIP_DAEMON_BUILD=1` to skip explicitly (the installed app will then show
> "daemon executable not found" in the MCP panel — not recommended).

## Quick start

From launch to your first data point in under three minutes — everything happens inside the app, no command line.

### 1. Add your first platform

Click the "＋" button at the bottom, expand a platform in the tree, click a product to jump straight to its form, and configure it by access type:

| Access type | Platforms | Steps |
|-------------|-----------|-------|
| **Key and go** | DeepSeek · Kimi · opencode · Zhipu GLM · MiniMax | Generate an API key in the platform console (MiniMax: the `sk-cp-` Token Plan subscription key) → paste → Test connection → Save instance |
| **CLI one-click auth** | Alibaba Bailian · Volcengine Ark | If the CLI is missing, follow the in-app one-click install; then tap "Authorize" on the card → the browser opens for login (Ark uses the SSO device-code flow) |
| **Session login** | Xiaomi MiMo | Tap "Authorize" → complete the Xiaomi account login in the popup window — the app captures the session automatically, no cookie copying |

Each instance starts polling independently as soon as it is saved: the first snapshot appears immediately, then refreshes on its own window cadence.

### 2. Read the panel

- **One card = one platform plan**: the progress bar shows current-window usage; "~N days left" is extrapolated from your recent burn rate (balance plans)
- **Color semantics**: green = healthy · yellow = needs attention (quota tight / credentials expired — the card carries the right button) · red = abnormal or exhausted · gray = not configured
- **Hover for details**: hover a card for window details; hover a progress bar for remaining quota and reset countdown (the tightest window gets a red left edge)
- **Drag to reorder**: drag a card to set your own order; persists on drop
- **Themes**: the ☀ button in the title bar cycles light / dark / system; glass transparency is adjustable in Settings (translucent + backdrop blur)

### 3. Connect your AI agents (optional)

Running Hermes / Claude Code / opencode / Codex? Route their local token spend into the "Agent usage" dashboard automatically:

1. Settings → "MCP Service" → click "Start" (the daemon ships with the installer — works out of the box)
2. Click "Copy guide link" and paste the link to your agent — the agent reads the built-in doc and completes integration & reporting on its own (auth → API spec → example → verify), no manual config
3. Every LLM call flows in automatically; switch to the "Local Agent" tab and click the usage card at the top ("Open usage dashboard") for live tokens / cost / cache hit rate

### 4. Stay updated

Built-in auto-update since v0.2.0: silent check on launch, one-click upgrade in Settings → About; instances and history are fully preserved.

> For the full screen-by-screen manual (Volcengine SSO self-heal, tray behavior, etc.), see [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## FAQ

**Q: SmartScreen blocks the install?**
Expected for an unsigned app: "More info" → "Run anyway".

**Q: Where do I get API keys?**

| Platform | Where |
|----------|-------|
| DeepSeek | platform.deepseek.com → API Keys |
| Kimi Coding | platform.moonshot.cn → open platform → API Key (Coding plan) |
| opencode | opencode.ai → account Settings → API Keys (zen/go plans) |
| Zhipu bigmodel | bigmodel.cn → API Keys (Coding Plan key; same as the coding inference key) |
| MiniMax | platform.MiniMax.io → Token Plan subscription management (key prefix `sk-cp-`) |
| Xiaomi MiMo | Nothing to fetch — tap "Authorize" when adding and log in once in the popup (the app captures the session automatically) |

**Q: How do I authorize Bailian / Volcengine Ark? Why a CLI?**
Both platforms' usage APIs only accept control-console login sessions (managed by the official
CLI `bl` / `arkcli`), not API keys. **Since v0.2.8 it's all in-app**: when adding an instance,
if the CLI is missing from PATH, a one-click install button kicks off automatically; then tap
"Authorize" on the card → the OneClickAuth panel opens the browser for login (Ark uses the SSO
device-code flow). **Never touch the command line.**
Sessions are server-side time-limited (empirically a few days); when expired, the card turns
yellow and shows a "Please re-authorize" button — click it to self-heal
(Volcengine SSO self-heal: see [USER_GUIDE.md §4](docs/USER_GUIDE.md)).
Xiaomi MiMo works the same in-app way: tap "Authorize" when adding and complete the Xiaomi account login in the popup — nothing to copy.

**Q: What does a yellow/red card mean?**
Yellow = needs attention (quota low or credentials expired; the card carries the exact fix
command (one click to copy), or a "Please re-authorize" button for one-click self-recovery).
Red = abnormal or quota exhausted; gray = not configured.
Hover a window progress bar to see remaining quota and reset time.

**Q: Are my keys and usage data safe?**
Keys live in the OS keychain (Windows Credential Manager / macOS Keychain); config files store references,
never plaintext. Snapshots land in local SQLite. The app has no telemetry/reporting code;
the only network requests are to the official endpoints of channels you added on the Settings page.

> For card reordering, the glass theme, and updates, see the [USER_GUIDE.md](docs/USER_GUIDE.md).

## Docs

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — **user manual**: clone → add provider (key / CLI auth / session login) → authorize → read data → settings; includes Volcengine SSO self-heal
- [docs/DESIGN.md](docs/DESIGN.md) — architecture & design (two-layer channel model / adapter system / scheduling / UI)
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision records (D-001 ~ D-059, each with empirical evidence)
- [TESTING.md](TESTING.md) — test matrix and how to run
- [RELEASE.md](RELEASE.md) — release manual

## Roadmap

### Near term

- MiniMax pay-as-you-go balance channel (`sk-api-` key; `query_balance` endpoint proven)
- Volcengine Ark expansion: free quota / media-asset views (usage balance control-plane commands)

### Mid term

- MCP data plane "cloud × local" usage comparison view (mcp-server data-plane extension)
- Meituan LongCat, opencode zen pay-as-you-go channels

### Long term

- Code signing (remove SmartScreen warning), CI automation
- macOS / Linux installers: code-ready (safeStorage / derived paths), needs real-machine validation before publishing

Full channel-level plan: [docs/DESIGN.md §5.2](docs/DESIGN.md).

## License

[Apache License 2.0](LICENSE)
