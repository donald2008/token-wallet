<div align="center">

# 💳 token-wallet

**All your AI quota, at a glance.** Don't let a three-hour task chain die because one platform's quota silently ran out.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React%2019-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Platforms 7](https://img.shields.io/badge/Platforms-7-6E56CF)](#supported-channels)
[![gitee primary](https://img.shields.io/badge/gitee-ITEater%2Ftoken--wallet-C71D23?logo=gitee&logoColor=white)](https://gitee.com/ITEater/token-wallet)
[![中文](https://img.shields.io/badge/docs-%E4%B8%AD%E6%96%87-blue)](README.md)

**DeepSeek · Kimi · opencode · Zhipu GLM · MiniMax · Alibaba Bailian · Volcengine Ark** — quota
windows from seven AI platforms in a single 360×720px desktop widget: progress bars, reset
countdowns, and "days remaining" estimated from your consumption rate.

> **The silent bomb of the multi-agent era**: token spend is scattered across plans — 5-hour
> rolling windows, weekly windows, monthly windows, prepaid balances. Your long-running job
> dies at 3 a.m. and you only find out after digging through terminals: one platform's quota
> ran out two hours ago. **token-wallet deletes this failure mode from your workflow.**

| Agent Usage Dashboard (Dark / Light / Glass) |
|------|
| ![dashboard dark](docs/screenshots/dashboard-dark.png) |
| ![dashboard light](docs/screenshots/dashboard-light.png) |
| ![dashboard glass](docs/screenshots/dashboard-glass.png) |

**Paste a key and go (HTTP channels) · One-click authorize in app (CLI channels, auto-opens browser) · Zero telemetry · Data never leaves your machine**

</div>

## Why token-wallet

- **Read at a glance** — a compact 360×720 panel shows remaining quota and countdowns for every window without opening a single provider console
- **Early warning** — extrapolates "days remaining" from recent consumption rate; cards change color before quota runs out, not after
- **Failures are explicit** — invalid key / missing CLI / expired session: the card tells you exactly how to fix it, never shows fake data; Volcengine Ark SSO expiry surfaces a one-click "re-authorize" button
- **Five layout variants** — `row` / `duo` / `hero` / `micro` / `ticker` containers auto-switch by window width; `micro` keeps the percentage always visible
- **Optional glass theme** — toggle in Settings → Appearance, drag a 0-100% transparency slider; preview while dragging, persist on release
- **Drag-to-reorder = manual sort** — drag any card to take over ordering; persists exactly once on drop; no drag library
- **Cache-first** — snapshots land in local SQLite; numbers appear on launch, readable offline, UI never waits on the network
- **Engineering restraint** — adding a channel = registering one declarative mapping, zero scripts, zero eval; credentials only ever touch the OS keychain

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

- Built-in channels for seven platforms; paste a key — or **authorize in-app** for the official CLI — and go
- One unified view for three plan archetypes: window-based (multi-window progress bars + reset countdowns) / balance-based (balance + estimated days left)
- CLI channels **one-click authorize in-app**: tap "Authorize" on the card → OneClickAuth panel pops up, browser opens for login; tapping the done-state button = trigger a refresh (D-048); the command line is never touched
- 360×720px compact panel; multi-window instances auto-use `P5MonitorShortSide` layout: 5h + weekly on one row (two columns), monthly full-width on its own row
- Card filtering (all / available / abnormal) — three icon buttons absolutely positioned at the top-right of the card list
- **Drag-to-reorder = manual sort**: dragging a card takes over ordering; persists exactly once on drop. Since v0.2.8 the three-tier name/urgency sort is collapsed to **manual-only** (D-039 + t_d086543b)
- Layout variants: `row` / `duo` / `hero` / `micro` / `ticker` — five container shapes auto-adapt to window width; `micro` keeps the percentage always visible
- Glass theme + transparency slider: toggle in Settings → Appearance, drag 0-100% to preview live, persist on release
- Delete button: always shown at the top-right of each card; hover activates the hit zone; click pops a confirm bubble (anti-misclick)
- Explicit failures: invalid key, missing CLI, API changes all produce a readable card with fix instructions — never fake data
- **Volcengine Ark SSO self-healing**: all lock-contention / session-expired bodies route to `auth_expired` one-click authorize (D-052), no more "stale" dead-ends
- Cache-first: snapshots to local SQLite; last-known data visible offline
- Credentials in the OS keychain (Windows Credential Manager / macOS Keychain); config files never hold secrets
- dark / light / glass themes; theme follows the system by default, manual override available
- zh / en bilingual: Settings → Language segmented control switches instantly; persists across restarts
- Zero telemetry, zero reporting, data stays on your machine (privacy notice on first launch)

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

> MiniMax (pay-as-you-go), Meituan LongCat, opencode zen balance are planned (docs/DESIGN.md §5.2).
> Adding a channel = registering a declarative mapping in the channel registry, zero code
> for standard APIs; complex APIs use a TS adapter.

Channel-level prerequisites: the two CLI channels need the official CLI installed (a one
in-app install button handles it when missing the first time, D-023); all other channels
work with an API key:

| Channel | Extra dependency | Authorization (in-app one-click) |
|---------|-----------------|----------------------------------|
| Alibaba Bailian | `bl` CLI (one-click install in app) | Tap "Authorize" on the card → opens the Bailian console for browser login; CLI sessions are server-side time-limited (empirically a few days); expired sessions turn the card yellow and prompt re-authorize |
| Volcengine Ark | `arkcli` CLI (one-click install in app) | Tap "Authorize" on the card → SSO device-code browser verification; CLI sessions are server-side time-limited; expired sessions turn the card yellow and prompt re-authorize (**Volcengine SSO self-heal, see [USER_GUIDE.md](docs/USER_GUIDE.md)**) |

> **CLI channels no longer require the command line**: pre-v0.2.8 you had to run `bl auth login --console` or
> `arkcli auth login volc-sso --no-browser` in a terminal. Since v0.2.8 the OneClickAuth panel in the app handles
> it; the command line is a fallback only when the in-app panel fails. See [USER_GUIDE.md §4](docs/USER_GUIDE.md).

## Repository layout

```text
token-wallet/
├── packages/
│   ├── core/             collection core (pure TS lib): adapter registry / scheduler / cache / schema
│   ├── app/              Electron desktop widget (React 19): tray + popup + settings
│   └── mcp-server/       MCP data-plane daemon (planned, embeds core)
├── docs/                 DESIGN (architecture) / DECISIONS / RELEASE (release manual)
├── scripts/              Windows build scripts
├── sketches/             UI visual mockups (for review, can be discarded)
└── package.json          pnpm workspace
```

## Install

### Download the installer (recommended)

Current version **v0.2.8**, stable link (always points to the latest stable release, updated on every release):

```text
http://10.200.1.88:8889/token-wallet_setup.exe     # self-hosted (dev channel, auto-tracks master)
https://gitee.com/ITEater/token-wallet/releases/download/stable/token-wallet_setup.exe  # official stable
```

- Windows 10/11 x64; single-file fully-offline installer (~93 MB, bundles Chromium runtime, no external dependencies)
- Platform note: **officially supported on Windows** today. macOS / Linux are code-ready
  (credentials via system safeStorage, platform-derived paths) but no installers are
  published and no real-machine validation has been done — see [Roadmap](#roadmap)
- Verify: compare the installer against `SHA256SUMS.txt` in the Release assets
- First install: the installer is not code-signed; when SmartScreen says "Unknown publisher",
  click "More info" → "Run anyway" (expected behavior; signing is planned)
- Auto-update: built-in `electron-updater` since v0.2.0 (D-046, hosted at
  `http://10.200.1.88:8889/token-wallet/`); startup does a silent check-only; download and install
  are always user-triggered; see Settings → About

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

> ⚠️ **fresh clone must run** `corepack pnpm -C packages/core build`, otherwise app typecheck will report
> a wall of `@token-wallet/core/*` TS2307 errors because `core/dist/` is missing (even if your task
> doesn't touch core).

### Build the Windows installer

```bash
corepack pnpm build:win    # = corepack pnpm -r build + corepack pnpm -C packages/app dist:win
```

Output: `packages/app/release/token-wallet_<version>_setup.exe`. The packaging chain is
pure Node tooling (electron-builder) — no Rust / Visual Studio / WebView2 needed; see
[RELEASE.md](RELEASE.md) for the full release manual (incl. WSL2 prereqs: wine64 + npmmirror).

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

**Q: How do I authorize Bailian (bl)? Why a CLI?**
Bailian's usage API only accepts control-console login sessions (managed by the official CLI
`bl`), not API keys. **Since v0.2.8 it's all in-app**: when adding an instance, if `bl` is missing
from PATH, a one-click install button kicks off automatically (stdout streams live into the log drawer,
D-023); after install, add the instance again, tap "Authorize" on the card → OneClickAuth panel
opens the Bailian console for browser login. **Never touch the command line.**
Sessions are server-side time-limited (empirically a few days); when expired, the card turns yellow
and prompts re-authorize (also one-click).

**Q: How do I authorize Volcengine Ark (arkcli)?**
Ark uses the official CLI's SSO device-code flow: `arkcli auth login volc-sso --no-browser`.
**Since v0.2.8 same flow**: one-click install arkcli in app when missing, then tap "Authorize" on the
card → OneClickAuth panel pulls up the browser for SSO verification. **Never touch the command line.**
CLI session expiry or lock-contention bodies (`please run arkcli auth login` /
`requires Volcengine Ark SSO STS` etc.) → the card turns yellow and shows a "Please re-authorize" button;
**click that button to self-heal, no more "stale" dead-ends** (D-052 / t_f261dadb).
See [USER_GUIDE.md §4 Volcengine SSO self-heal](docs/USER_GUIDE.md).

**Q: What does a yellow/red card mean?**
Yellow = needs attention (quota low or credentials expired; the card carries the exact fix
command (one click to copy), or a "Please re-authorize" button for one-click self-recovery).
Red = abnormal or quota exhausted; gray = not configured.
Hover a window progress bar to see remaining quota and reset time.

**Q: How do I reorder cards?**
v0.2.8 ships with manual-only sort (D-039 + t_d086543b):
1. **Long-press and drag** any card (handle = the 16px brand-color block on the left edge of the card head, cursor turns `grab`)
2. The dragged card lifts, follows your pointer, other cards make way and show a drop-line indicator
3. **Persistence happens exactly once on drop** (no write thrash on rapid drags)
4. Configured in `settings.json` → `sortConfig.order`; switching back to manual restores the saved order

The legacy "name / urgency" auto-sort is removed. If `settings.json` still has an old config, the
launcher normalizes it to `manual` and keeps the `order` array (your drag order is preserved).

**Q: How do I enable the glass theme?**
Settings → Appearance:
1. Flip the "Glass" switch on
2. Drag the "Transparency" slider to your taste (default 100% opaque; 15% / 50% are common presets)
3. **Preview while dragging, persist on release** — the panel previews live, settings.json writes on slider release

**Q: Are my keys and usage data safe?**
Keys live in the OS keychain (Windows Credential Manager / macOS Keychain); config files store references,
never plaintext. Snapshots land in local SQLite. The app has no telemetry/reporting code;
the only network requests are to the official endpoints of channels you added on the Settings page.

**Q: Upgrading from v0.2.6 or earlier?**
v0.2.8 ships with auto-update (D-046): Settings → About → "Check for updates" → auto-download the latest
NSIS installer → "Restart to install" → done. Instances, settings, SQLite snapshots are all preserved
(NSIS `deleteAppDataOnUninstall:false` + stable userData directory).
If you're on a pre-v0.2.0 version, download the v0.2.8 installer manually once, then auto-update kicks in.

## Docs

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — **user manual**: clone → add provider → authorize → read data → settings; includes Volcengine SSO self-heal
- [docs/DESIGN.md](docs/DESIGN.md) — architecture & design (two-layer channel model / adapter system / scheduling / UI)
- [docs/DECISIONS.md](docs/DECISIONS.md) — decision records (D-001 ~ D-053, each with empirical evidence)
- [TESTING.md](TESTING.md) — test matrix and how to run
- [RELEASE.md](RELEASE.md) — release manual

## Roadmap

### Near term

- MiniMax pay-as-you-go balance channel (`sk-api-` key; `query_balance` endpoint proven)
- Volcengine Ark expansion: free quota / media-asset views (usage balance control-plane commands)

### Mid term

- MCP data plane: local Agent token consumption view + "cloud × local" comparison (mcp-server daemon)
- Meituan LongCat, opencode zen pay-as-you-go channels

### Long term

- Code signing (remove SmartScreen warning), CI automation, GitHub mirror
- macOS / Linux installers: code-ready (safeStorage / derived paths), needs real-machine validation before publishing

Full channel-level plan: [docs/DESIGN.md §5.2](docs/DESIGN.md).

## License

[Apache License 2.0](LICENSE)