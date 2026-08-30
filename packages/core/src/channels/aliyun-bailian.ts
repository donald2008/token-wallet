/**
 * aliyun-bailian/token-plan 真实通道 — command 类首实例 (D-041, 2026-08-30)
 *
 * bl CLI(百炼官方, `npm i -g bailian-cli`, 1.18.1 实测)包装。控制台会话
 * (~/.bailian/config.json)由 CLI 自管, app 不碰凭据文件 → params_schema=[]。
 *
 * 采集: `bl usage token-plan --output json`
 *   健康态 golden(Windows 真机, 2026-08-30):
 *     {"per1WeekPercentage": 0.37941547999999997, "per1WeekResetTime": 1788586320000}
 *   - per1WeekPercentage 是 0-1 小数(0.379=37.9% 已用, 勿当 0-100) → 归一 ×100 作 percent
 *   - per1WeekResetTime 毫秒 epoch → 秒存 reset_at
 *   - 单窗口(周); 5h 窗不限量时 per5h* 字段整个缺席 = 正常态, 不得报错
 *
 * 异常态判别(三层源码结论):
 *   - 会话失效: exit=3, body {"error":{"code":3,"message":"No console access token found."
 *     | 含 "not logged in or has expired","hint":"Run `bl auth login --console`."}}
 *     → auth_expired + setup_hint
 *   - `bl auth status` 未登录也 exit=0 → exit code 不可信, 一律解析 body
 *   - bl 不在 PATH(spawn ENOENT) → error 态, setup_hint 指向安装(D-023 一键安装本卡只留文案占位)
 *   - console access_token 过期是服务端黑盒, 不做本地过期预测, 采集失败即健康信号
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
import { ALIYUN_BAILIAN_TOKEN_PLAN } from "./presets.js";

/** bl usage 命令(固定: 采集固定 token-plan 单产品) */
export const BL_USAGE_CMD = "bl";
export const BL_USAGE_ARGS = ["usage", "token-plan", "--output", "json"];

/** health_check 命令(DESIGN.md §5.0: 判"从未配置", 不能判会话死活) */
export const BL_AUTH_STATUS_CMD = "bl";
export const BL_AUTH_STATUS_ARGS = ["auth", "status", "--output", "json"];

/** 会话失效判别串(exit=3 body / auth status body 共用) */
const AUTH_EXPIRED_PATTERNS = [
  "No console access token found",
  "not logged in or has expired",
];

/** 服务端错误码 NotLogined 同判 */
const NOT_LOGINED_PATTERN = "NotLogined";

/** 统一 setup_hint(卡片修复指引) */
const SETUP_HINT = "运行 `bl auth login --console` 重新授权(控制台会话由 CLI 管理)";
const INSTALL_HINT = "未检测到 bl CLI: 请安装(见 DESIGN.md D-023 一键安装)后重启应用";

/** runCommandResult 注入点(测试传假 runner; 缺省走真实 spawn) */
export type BailianRunner = (ctx: FetchContext) => Promise<CommandRunResult>;

function isAuthExpiredBody(body: string): boolean {
  if (body.includes(NOT_LOGINED_PATTERN)) return true;
  return AUTH_EXPIRED_PATTERNS.some((p) => body.includes(p));
}

/**
 * BailianTokenPlanAdapter — bl CLI command 通道首实例。
 * fetchSnapshot 三态: ok(解析 usage JSON) / auth_expired(exit=3 + 失效 body) /
 * error(ENOENT=未装 CLI, 其余失败)。
 */
export class BailianTokenPlanAdapter extends ScriptedAdapter {
  readonly kind = "command" as const;

  constructor(
    /** 测试注入: 替代真实 spawn 的 runner; 缺省用 runCommandResult */
    private readonly runner?: BailianRunner,
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
    };

    let res: CommandRunResult;
    try {
      res = await (this.runner
        ? this.runner(ctx as unknown as FetchContext)
        : this.runCommandResult(BL_USAGE_CMD, BL_USAGE_ARGS, ctx as unknown as FetchContext));
    } catch (err) {
      if (err instanceof SpawnError && err.code === "ENOENT") {
        return {
          ...base,
          status: "error",
          error_message: "bl CLI 不在 PATH, 请安装后重启应用",
          setup_hint: INSTALL_HINT,
        };
      }
      return {
        ...base,
        status: "error",
        error_message: err instanceof Error ? err.message : String(err),
      };
    }

    // D-041 round3(t_c561c8a8 终审 BLOCKING): 真实 bl 未登录时错误 JSON 写 **stderr**、
    // stdout 空(exit=3)。判别必须覆盖双 stream, 否则 auth_expired 永不命中。
    if (isAuthExpiredBody(res.stdout + res.stderr)) {
      return {
        ...base,
        status: "auth_expired",
        alerts: [{ level: "warn", message: "bl 控制台会话已失效, 请重新授权", code: "auth_expired" }],
        setup_hint: SETUP_HINT,
      };
    }
    if (res.code !== 0) {
      // win32 下 cmd /c 包装使 spawn ENOENT 不可达: bl 缺失时 cmd 非零退出
      // + stdout 空 + stderr "not recognized/不是内部或外部命令" → 与 ENOENT 同判
      if (isShellCommandNotFound(res)) {
        return {
          ...base,
          status: "error",
          error_message: "bl CLI 不在 PATH, 请安装后重启应用",
          setup_hint: INSTALL_HINT,
        };
      }
      return {
        ...base,
        status: "error",
        error_message: `bl usage 失败(exit=${res.code})`,
      };
    }

    // 健康态: 解析 usage JSON; 5h 窗字段缺席 = 正常(不限量), 不得报错
    try {
      const data = JSON.parse(res.stdout) as Record<string, unknown>;
      const weeklyPct = data.per1WeekPercentage;
      const weeklyResetMs = data.per1WeekResetTime;
      if (typeof weeklyPct !== "number" || typeof weeklyResetMs !== "number") {
        return {
          ...base,
          status: "error",
          error_message: "bl usage 响应缺少 per1Week 字段",
        };
      }
      const metrics: ProviderSnapshot["metrics"] = [
        {
          key: "weekly",
          kind: "window",
          unit: "percent",
          // 0-1 小数 → 0-100 百分数(D-041: 0.379=37.9% 已用)
          used: weeklyPct * 100,
          limit: 100,
          reset_at: Math.floor(weeklyResetMs / 1000),
        },
      ];
      // 5h 窗(per5hPercentage/per5hResetTime): 不限量时缺席 = 正常, 不补不报错
      const p5h = data.per5hPercentage;
      const r5h = data.per5hResetTime;
      if (typeof p5h === "number" && typeof r5h === "number") {
        metrics.push({
          key: "rolling_5h",
          kind: "window",
          unit: "percent",
          used: p5h * 100,
          limit: 100,
          reset_at: Math.floor(r5h / 1000),
        });
      }
      return { ...base, status: "ok", metrics };
    } catch (err) {
      return {
        ...base,
        status: "error",
        error_message: `bl usage 输出解析失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** healthCheck(§5.0): `bl auth status --output json` 判"从未配置"; 会话死活由采集判定 */
  async healthCheck(
    _descriptor: ChannelDescriptor,
    _instance: InstanceConfig,
    ctx: AdapterContext,
  ): Promise<{ ok: boolean; setupHint?: string }> {
    let res: CommandRunResult;
    try {
      res = await (this.runner
        ? this.runner(ctx as unknown as FetchContext)
        : this.runCommandResult(BL_AUTH_STATUS_CMD, BL_AUTH_STATUS_ARGS, ctx as unknown as FetchContext));
    } catch (err) {
      if (err instanceof SpawnError && err.code === "ENOENT") {
        return { ok: false, setupHint: INSTALL_HINT };
      }
      // auth status 失败不判会话失效(exit code 不可信); 返回 ok 让采集给结论
      return { ok: true };
    }
    // D-041 round3: auth status 失效 body 同样可能落 stderr, 与采集同口径判双 stream
    if (isAuthExpiredBody(res.stdout + res.stderr)) {
      return { ok: false, setupHint: SETUP_HINT };
    }
    // win32 cmd /c 包装: bl 缺失 → 非零退出 + stderr 未找到 → 安装提示
    if (isShellCommandNotFound(res)) {
      return { ok: false, setupHint: INSTALL_HINT };
    }
    return { ok: true };
  }
}

/** 便捷构造(引擎/测试连接共用) */
export function bailianTokenPlanAdapter(): BailianTokenPlanAdapter {
  return new BailianTokenPlanAdapter();
}

/**
 * command 通道适配器注册表(D-036 对应 CHANNEL_MAPPINGS 的 command 半边):
 * 设置页能选到的 command 通道必然有真实适配器, 否则又"选得到但采不到"。
 * 不变量由单测保证: PRESET_CHANNELS 中 adapter=command 的通道 ⊆ 本表。
 */
export const COMMAND_ADAPTERS: Readonly<Record<string, () => ScriptedAdapter>> = {
  "aliyun-bailian/token-plan": bailianTokenPlanAdapter,
};

export { ALIYUN_BAILIAN_TOKEN_PLAN };
