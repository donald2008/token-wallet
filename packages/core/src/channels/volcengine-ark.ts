/**
 * volcengine-ark/coding-plan 真实通道 — command 类第二实例(D-044, D-041 之后, 2026-08-31)
 *
 * arkcli(火山方舟官方, `npm i -g @volcengine/ark-cli`, 1.0.23 实测)包装。控制面
 * 会话由 CLI 自管(volc-sso SSO), app 不碰凭据文件 → params_schema=[]。
 *
 * 采集: `arkcli usage plan --format json`(auto-discover 4 SKU: agent/coding × personal/team;
 *   响应按产品拆成 items[], 本通道取 product=coding-plan 的个人整订子项)。
 *   健康态 golden(官方 binary 内嵌 skill 文档 + pi-ark-quota 双源证实, 2026-08-31):
 *     {"ok":true,"items":[{"product":"coding-plan","subscribed":true,
 *        "periods":[{"label":"session","used":…,"total":…,"percent":25,"reset_at":"RFC3339"},
 *                   {"label":"weekly",…},{"label":"monthly",…}]}]}
 *   - CodingPlan periods label = session(5h) / weekly / monthly; percent 已是 0-100 百分数
 *     (勿 ×100, 与 bl 的 0-1 小数不同)
 *   - reset_at 是 RFC3339(UTC+08:00)字符串 → Date.parse 取秒
 *   - 个人版单 SKU 场景直接取 coding/personal
 *
 * 异常态判别(1.0.23 干净 HOME 实测):
 *   - 未登录/SSO 过期: exit=1, stdout 空, **stderr** 写
 *     {"ok":false,"error":{"type":"error","message":"not configured, run `arkcli config init
 *       --profile default` or `arkcli auth login`"}} → auth_expired + setup_hint
 *     (t_c561c8a8 同款教训: 错误 body 落 stderr, 判别必须覆盖 stdout+stderr 双 stream)
 *   - `arkcli auth status --format json` 未登录也 exit=0, 输出
 *     {"auth_method":"none","hint":"run `arkcli auth login` …","logged_in":false}
 *     → REAL 判别字段是 logged_in(非 task 假设的 ok), health_check 判从未配置用 logged_in
 *   - arkcli 不在 PATH(spawn ENOENT) / win32 cmd /c 包壳下 cmd 非零退出 + stderr → error
 */
import type { ChannelDescriptor } from "./descriptor.js";
import {
  ScriptedAdapter,
  SpawnError,
  isShellCommandNotFound,
  type CommandRunResult,
} from "../adapters.js";
import type { ProviderSnapshot } from "../schema.js";
import type { FetchContext } from "../scheduler.js";
import type { AdapterContext, InstanceConfig } from "../generic-http.js";
import { VOLCENGINE_ARK_CODING_PLAN } from "./presets.js";

/** arkcli usage 命令(固定: auto-discover 全部 SKU, 适配器内筛 coding-plan) */
export const ARK_USAGE_CMD = "arkcli";
export const ARK_USAGE_ARGS = ["usage", "plan", "--format", "json"];

/** health_check 命令(DESIGN.md §5.0: 判"从未配置", 不能判会话死活) */
export const ARK_AUTH_STATUS_CMD = "arkcli";
export const ARK_AUTH_STATUS_ARGS = ["auth", "status", "--format", "json"];

/** 采集目标产品(个人版 coding-plan 整订; 团队 coding-plan-team 不在此通道) */
export const ARK_PRODUCT = "coding-plan";

/** 会话失效/未登录判别串(usage plan stderr body 与 auth status body 共用) */
const AUTH_EXPIRED_PATTERNS = [
  "not configured",
  // t_ee76442e: 删 "auth login" 串。原因: arkcli 撞锁 body 自带引导文案 `please run arkcli
  // auth login volc-sso`, 命中该串会让纯并发锁竞争被误判为会话失效。判别精确化交给下方
  // 三个新增的真 token 失效串(refresh_token is invalid / token 交换失败 / invalid_request)。
  // 真「未登录从未配置」场景仍由 "not configured" + "not logged in" + "logged_in=false" 共同
  // 覆盖(healthCheck 段独立用 JSON 字段判别)。
  "login expired",
  "SSO token expired",
  "refresh token",
  "not logged in",
  // t_ee76442e: SSO refresh_token 被吊销的真 token 失效串(volc-sso RFC 6749 invalid_request
  // 错误文案)。必须区别于「STS 续期失败」的纯锁竞争语义: 真 token 失效只能重走 auth login,
  // 退避重试无意义; arkcli 1.0.22 真机 body 同体出现「STS 续期失败」「另一个 arkcli 进程
  // 正在刷新」+「token 交换失败: invalid_request - refresh_token is invalid」时, 真因是
  // refresh_token 失效, 不是锁竞争。
  "refresh_token is invalid",
  "token 交换失败",
  "invalid_request",
] as const;

/** 统一 setup_hint(卡片修复指引; 任务契约: SSO refresh_token 过期是常态, 比 bl 频繁) */
const SETUP_HINT = "运行 `arkcli auth login volc-sso --no-browser` 重新授权(SSO 会话由 CLI 管理)";
const INSTALL_HINT = "未检测到 arkcli: 请安装 `npm i -g @volcengine/ark-cli` 后重启应用";

/* ---- STS 续期撞锁重试(t_9e4610a8, 2026-09-01 真机实锤) ----
 * arkcli 对 sts.json(短命 AK/SK+session_token)的续期有**进程级单飞锁**——调度器采集
 * 与用户手动 arkcli(或同时刻两个实例)并发刷新时, 后到者 exit!=0 + 锁竞争 body:
 *   "... STS 续期失败: 另一个 arkcli 进程正在刷新 SSO 凭证，请稍后重试"
 * 此类瞬时竞争不应上报「采集失败」(scheduler 兜底), 改为短暂退避后重试(串行, 最多 2 次)。
 * 3 次仍失败 = 长期锁占用(异常) → status=stale 灰卡 + sts_refresh_locked 告警(卡片主案,
 * round1 审查修正: schema stale 一等公民 + UI 灰卡/告警文案可见, 不打红卡「采集失败」)。
 */
export const STS_LOCK_PATTERNS = ["另一个 arkcli 进程正在刷新", "STS 续期失败"] as const;
export const STS_LOCK_MAX_RETRIES = 2;
export const STS_LOCK_RETRY_DELAY_MS = 2_000;

/* ---- 残留锁自愈(B层, t_91ae22ff, 2026-09-07 用户拍板) ----
 * arkcli 的 SSO 刷新锁 = ~/.arkcli/cache/auth/refresh-<hash>.lock(0 字节**创建式**锁,
 * 非 flock)。app 采集超时被强杀(runCommand SIGTERM→5s SIGKILL)或进程异常退出 →
 * 锁文件残留, 永不自动释放 → 后续每次采集撞这把残留锁 → 重试耗尽 → 永久 stale 灰卡。
 * 自愈: 撞锁且重试耗尽后, 检查 refresh-*.lock 的 mtime: 超过 STS_LOCK_STALE_MS(5min)
 * = 残留锁 → 删除 → 立即再跑一次采集(单次不循环); 仍撞锁 → 走原 stale 逻辑(不无限抢)。
 * 锁文件 mtime 年轻(< 阈值)= 活跃刷新, **绝不删**(避免与真实并发刷新打架)。
 * mtime 阈值是唯一判据(锁文件 0 字节无内容可查); 删除失败(Windows 句柄占用等)
 * → 静默跳过, 等下轮轮询再试, 不报错。sts_refresh_locked 告警文案保留不变。
 */
export const STS_LOCK_STALE_MS = 5 * 60_000;

/** 锁文件操作助手(测试注入; 缺省走 node:fs 动态 import——browser-safe: 顶层零静态 node:* import) */
export interface ArkLockFs {
  /** 列出 auth 目录下 refresh-*.lock 的完整路径; 目录不存在/读取失败返回空数组(不抛) */
  listLocks(dir: string): Promise<string[]>;
  /** 取锁文件 mtime(毫秒 epoch); 文件不存在/stat 失败返回 undefined */
  statMtimeMs(path: string): Promise<number | undefined>;
  /** 删除锁文件; 删除失败(Windows 句柄占用等)返回 false */
  unlink(path: string): Promise<boolean>;
}

/** 解析 arkcli auth 锁目录(缺省 ~/.arkcli/cache/auth; 测试注入可指向临时目录) */
export type ResolveArkLockDir = () => Promise<string>;

const defaultLockFs: ArkLockFs = {
  async listLocks(dir) {
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.startsWith("refresh-") && e.name.endsWith(".lock"))
        .map((e) => join(dir, e.name));
    } catch {
      return [];
    }
  },
  async statMtimeMs(path) {
    const { stat } = await import("node:fs/promises");
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      return undefined;
    }
  },
  async unlink(path) {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(path);
      return true;
    } catch {
      return false;
    }
  },
};

/** 缺省锁目录: ~/.arkcli/cache/auth(os.homedir() 跨平台, Windows=USERPROFILE) */
const defaultResolveLockDir: ResolveArkLockDir = async () => {
  const os = await import("node:os");
  const { join } = await import("node:path");
  return join(os.homedir(), ".arkcli", "cache", "auth");
};

/** 撞锁判别: stdout+stderr 双 stream 命中其一即视为 STS 续期锁竞争(与 auth_expired 判别互斥)
 *
 * t_ee76442e 修正: 收紧为「纯锁竞争」= STS_LOCK_PATTERNS 命中 **且** 不同时含 auth_expired
 * 真 token 失效串。原因: arkcli 1.0.22 真机 body 同体出现「STS 续期失败」「另一个 arkcli 进
 * 程正在刷新」+「token 交换失败: invalid_request - refresh_token is invalid」时, 真因是
 * SSO refresh_token 失效(volc-sso RFC 6749 invalid_request), 不是锁竞争。若不过滤 →
 * 退避重试 3 次浪费 + 永远 stale + 「请稍候自动重试」误导文案 + 一键授权按钮永远不出。
 * 纯并发锁竞争(手动 arkcli 同时刷新 sts.json)→ body 仅含 STS_LOCK_PATTERNS, 不含 token
 * 失效串 → 走原 stale 逻辑(回归不破)。
 */
function isStsLockBody(body: string): boolean {
  if (!STS_LOCK_PATTERNS.some((p) => body.includes(p))) return false;
  // 锁竞争字样 + 真 token 失效字样同体 → 真因是 SSO refresh_token 被吊销, 非瞬时锁竞争
  if (isAuthExpiredBody(body)) return false;
  return true;
}

/** 串行等待(重试退避; 测试注入 0 跳过) */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** runCommandResult 注入点(测试传假 runner; 缺省走真实 spawn) */
export type ArkRunner = (ctx: FetchContext) => Promise<CommandRunResult>;

function isAuthExpiredBody(body: string): boolean {
  // 未登录 body: {"ok":false,"error":{"message":"not configured … or `arkcli auth login`"}}
  // 判别串命中其一即视为会话失效(SSO/未配置), 不依赖 exit code
  return AUTH_EXPIRED_PATTERNS.some((p) => body.includes(p));
}

/** RFC3339 字符串或毫秒 epoch → unix 秒; 解析失败返回 undefined(调用方兜底不报错) */
function parseResetAt(raw: unknown): number | undefined {
  if (typeof raw === "number") return Math.floor(raw / 1000);
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
  }
  return undefined;
}

/** CodingPlan period label → 指标 key(session=5h 窗, 对齐 bars 模板 windowSpanRank) */
function periodKey(label: string): string {
  switch (label) {
    case "session":
    case "5h":
      return "rolling_5h";
    case "weekly":
      return "weekly";
    case "monthly":
      return "monthly";
    default:
      return label;
  }
}

/**
 * VolcengineArkCodingPlanAdapter — arkcli command 通道(火山方舟 Coding Plan)。
 * fetchSnapshot 三态: ok(解析 items[].coding-plan periods) / auth_expired(exit=1 +
 * 失效 body) / error(ENOENT=未装 CLI, win32 包壳缺失, 其余失败)。
 */
export class VolcengineArkCodingPlanAdapter extends ScriptedAdapter {
  readonly kind = "command" as const;

  constructor(
    /** 测试注入: 替代真实 spawn 的 runner; 缺省用 runCommandResult */
    private readonly runner?: ArkRunner,
    /** STS 撞锁重试退避时长(测试注入 0 跳过等待) */
    private readonly stsRetryDelayMs: number = STS_LOCK_RETRY_DELAY_MS,
    /** 残留锁自愈: 锁文件操作助手(测试注入 fake; 缺省 node:fs 动态 import) */
    private readonly lockFs?: ArkLockFs,
    /** 残留锁自愈: auth 锁目录解析(测试注入指向临时目录; 缺省 ~/.arkcli/cache/auth) */
    private readonly resolveLockDir?: ResolveArkLockDir,
    /** 残留锁自愈: 锁文件 mtime 陈旧阈值(测试注入; 缺省 5min) */
    private readonly stsLockStaleMs: number = STS_LOCK_STALE_MS,
  ) {
    super();
  }

  async fetchSnapshot(
    descriptor: ChannelDescriptor,
    instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<ProviderSnapshot> {
    const base = {
      provider_id: instance.id,
      display_name: instance.name,
      plan_type: descriptor.plan_type,
      fetched_at: ctx.fetchedAt,
      metrics: [],
      alerts: [],
      logo: descriptor.logo,
    };

    let res: CommandRunResult;
    try {
      // STS 续期撞锁重试: exit!=0 且 body 命中锁竞争 → 串行退避重跑(最多 2 次)。
      // 与手动 arkcli 并发刷新 sts.json 是瞬时竞争, 重试后自愈; 不放大并发(串行 sleep)。
      const runOnce = () =>
        this.runner
          ? this.runner(ctx as unknown as FetchContext)
          : this.runCommandResult(ARK_USAGE_CMD, ARK_USAGE_ARGS, ctx as unknown as FetchContext);
      res = await runOnce();
      for (let attempt = 0; attempt < STS_LOCK_MAX_RETRIES && res.code !== 0 && isStsLockBody(res.stdout + res.stderr); attempt++) {
        await sleep(this.stsRetryDelayMs);
        res = await runOnce();
      }

      // 残留锁自愈(B层, t_91ae22ff): 重试耗尽仍撞锁 = 可能是 app 强杀/进程异常退出后
      // 遗留的陈旧锁文件(创建式锁永不自动释放)。检查 refresh-*.lock mtime > 阈值 →
      // 删除 → 立即再跑一次采集(单次不循环); 删后仍撞锁 → 走下方原 stale 逻辑(不无限抢)。
      if (res.code !== 0 && isStsLockBody(res.stdout + res.stderr)) {
        const healed = await this.healStaleLock(runOnce);
        if (healed !== null) {
          res = healed; // 删除残留锁后的单次重跑结果 → 统一走下方判别链
        }
      }
    } catch (err) {
      if (err instanceof SpawnError && err.code === "ENOENT") {
        return {
          ...base,
          status: "error",
          error_message: "arkcli CLI 不在 PATH, 请安装后重启应用",
          setup_hint: INSTALL_HINT,
        };
      }
      return {
        ...base,
        status: "error",
        error_message: err instanceof Error ? err.message : String(err),
      };
    }

    // 撞锁判别(t_ee76442e 收紧): isStsLockBody 已排除「真 token 失效同体」, 纯并发锁竞争
    // 才会落到此分支。arkcli 锁竞争 body 不再内嵌 "auth login" 误导提示(纯 STS_LOCK 字样),
    // 顺序保持先 sts → 后 auth_expired, 纯 token 失效同体直接 auth_expired, 不重试不退避。
    if (res.code !== 0 && isStsLockBody(res.stdout + res.stderr)) {
      return {
        ...base,
        status: "stale",
        alerts: [
          {
            level: "warn",
            code: "sts_refresh_locked",
            message: "火山方舟 SSO 凭证刷新中(另一进程占用), 请稍候自动重试",
          },
        ],
      };
    }
    // 未登录 error body 落 **stderr**(exit=1, stdout 空; 同 bl round3 教训)——
    // 判别必须覆盖 stdout+stderr 双 stream
    if (isAuthExpiredBody(res.stdout + res.stderr)) {
      return {
        ...base,
        status: "auth_expired",
        alerts: [{ level: "warn", message: "火山方舟 SSO 会话已失效, 请重新授权", code: "auth_expired" }],
        setup_hint: SETUP_HINT,
      };
    }
    if (res.code !== 0) {
      // win32 下 cmd /c 包装使 spawn ENOENT 不可达: arkcli 缺失时 cmd 非零退出
      // + stdout 空 + stderr "not recognized/不是内部或外部命令" → 与 ENOENT 同判
      if (isShellCommandNotFound(res)) {
        return {
          ...base,
          status: "error",
          error_message: "arkcli CLI 不在 PATH, 请安装后重启应用",
          setup_hint: INSTALL_HINT,
        };
      }
      return {
        ...base,
        status: "error",
        error_message: `arkcli usage 失败(exit=${res.code})${res.stderr.trim() ? `: ${res.stderr.trim().slice(0, 200)}` : ""}`,
      };
    }

    // 健康态: 解析 items[], 取 product=coding-plan 且 subscribed 的整订子项
    try {
      const data = JSON.parse(res.stdout) as Record<string, unknown>;
      const items = data.items;
      if (!Array.isArray(items)) {
        return { ...base, status: "error", error_message: "arkcli usage 响应缺少 items 数组" };
      }
      const item = (items as Array<Record<string, unknown>>).find(
        (i) => i.product === ARK_PRODUCT && i.subscribed === true,
      );
      if (!item) {
        return {
          ...base,
          status: "error",
          error_message: "未找到 coding-plan 订阅(coding/personal); 请在火山方舟控制台开通 Coding Plan",
        };
      }
      const periods = item.periods;
      if (!Array.isArray(periods) || periods.length === 0) {
        return { ...base, status: "ok", metrics: [] };
      }
      const metrics: ProviderSnapshot["metrics"] = [];
      for (const period of periods as Array<Record<string, unknown>>) {
        const label = typeof period.label === "string" ? period.label : "";
        const percent = period.percent;
        if (typeof percent !== "number" || Number.isNaN(percent)) {
          // used/total 兜底推导(percent 缺席时)
          if (typeof period.used === "number" && typeof period.total === "number" && period.total > 0) {
            metrics.push({
              key: periodKey(label),
              kind: "window",
              unit: "percent",
              used: (period.used / period.total) * 100,
              limit: 100,
              reset_at: parseResetAt(period.reset_at),
            });
          }
          continue;
        }
        metrics.push({
          key: periodKey(label),
          kind: "window",
          unit: "percent",
          // CodingPlan percent 已是 0-100(勿 ×100)
          used: percent,
          limit: 100,
          reset_at: parseResetAt(period.reset_at),
        });
      }
      return { ...base, status: "ok", metrics };
    } catch (err) {
      return {
        ...base,
        status: "error",
        error_message: `arkcli usage 输出解析失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 残留锁自愈(B层, t_91ae22ff): 撞锁重试耗尽后尝试清理陈旧 refresh-*.lock 并重跑一次。
   * 返回 null = 未触发自愈(无锁文件/全部年轻/删除失败) → 调用方走原 stale 逻辑。
   */
  private async healStaleLock(runOnce: () => Promise<CommandRunResult>): Promise<CommandRunResult | null> {
    try {
      const lockFs = this.lockFs ?? defaultLockFs;
      const dir = await (this.resolveLockDir ? this.resolveLockDir() : defaultResolveLockDir());
      const locks = await lockFs.listLocks(dir);
      if (locks.length === 0) return null; // 无锁文件 → 未触发自愈
      const now = Date.now();
      let removedAny = false;
      for (const lockPath of locks) {
        const mtimeMs = await lockFs.statMtimeMs(lockPath);
        if (mtimeMs === undefined) continue; // stat 失败(文件已被并发删除等) → 跳过该锁
        if (now - mtimeMs <= this.stsLockStaleMs) continue; // mtime 年轻 = 活跃刷新, 绝不删
        // 超过阈值 = 残留锁 → 删除; 删除失败(Windows 句柄占用等) → 静默跳过, 等下轮轮询
        if (await lockFs.unlink(lockPath)) removedAny = true;
      }
      if (!removedAny) return null; // 无残留锁被删 → 不重跑, 走原 stale
      return await runOnce(); // 删除残留锁后立即再跑一次采集
    } catch {
      return null; // 任何异常(fs/动态 import 失败等)静默走原 stale 逻辑, 不报错
    }
  }

  /** healthCheck(§5.0): `arkcli auth status --format json` 判"从未配置"; 会话死活由采集判定 */
  async healthCheck(
    _descriptor: ChannelDescriptor,
    _instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<{ ok: boolean; setupHint?: string }> {
    let res: CommandRunResult;
    try {
      res = await (this.runner
        ? this.runner(ctx as unknown as FetchContext)
        : this.runCommandResult(ARK_AUTH_STATUS_CMD, ARK_AUTH_STATUS_ARGS, ctx as unknown as FetchContext));
    } catch (err) {
      if (err instanceof SpawnError && err.code === "ENOENT") {
        return { ok: false, setupHint: INSTALL_HINT };
      }
      return { ok: true };
    }
    // auth status 失效 body 同样可能落 stderr, 与采集同口径判双 stream
    if (isAuthExpiredBody(res.stdout + res.stderr)) {
      return { ok: false, setupHint: SETUP_HINT };
    }
    if (isShellCommandNotFound(res)) {
      return { ok: false, setupHint: INSTALL_HINT };
    }
    // REAL 判别字段是 logged_in(1.0.23 实测: 未登录输出 logged_in=false 且 exit=0)
    try {
      const body = JSON.parse(res.stdout) as { logged_in?: boolean };
      if (body.logged_in === false) {
        return { ok: false, setupHint: SETUP_HINT };
      }
    } catch {
      /* 非 JSON → 不判会话死活, 返回 ok 让采集给结论 */
    }
    return { ok: true };
  }
}

/** 便捷构造(引擎/测试连接共用) */
export function volcengineArkCodingPlanAdapter(): VolcengineArkCodingPlanAdapter {
  return new VolcengineArkCodingPlanAdapter();
}

export { VOLCENGINE_ARK_CODING_PLAN };