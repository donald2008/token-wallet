/**
 * 安全 JSONPath 求值 — DESIGN.md §5.1
 *
 * 用 jsonpath-plus 纯求值, 显式禁 eval; 状态断言用受限比较表达式(手写解析,
 * 无 eval/new Function); 管道过滤器白名单(number/string/round/duration)。
 */
import { JSONPath } from "jsonpath-plus";

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

/** JSONPath 纯求值(禁脚本表达式)。path 必须以 $ 开头 */
export function evalJsonPath(json: unknown, path: string): unknown[] {
  if (!path.startsWith("$")) {
    throw new MappingError(`JSONPath 必须以 $ 开头: ${path}`);
  }
  // eval:false — 脚本表达式一律不执行(jsonpath-plus v10 安全模式)
  return JSONPath({
    json: json as object,
    path,
    eval: false,
  }) as unknown as unknown[];
}

/** 取第一个值(标量映射常用) */
export function evalJsonPathFirst(json: unknown, path: string): unknown {
  return evalJsonPath(json, path)[0];
}

// ---- 管道过滤器白名单(§5.1: number/string/round/duration/iso_epoch) ----

export type PipeFilter = "number" | "string" | "round" | "duration" | "iso_epoch" | "ms_epoch" | "invert_percent";

/** ISO 8601(YYYY-MM-DDTHH:mm:ss[.fff…][Z|±HH[:]MM]) — 容忍任意毫秒小数精度与 Z/偏移时区 */
const ISO_8601_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

const FILTERS: Record<PipeFilter, (v: unknown) => unknown> = {
  number: (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new MappingError(`无法转 number: ${typeof v}`);
    return n;
  },
  string: (v) => String(v),
  round: (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new MappingError(`无法 round: ${typeof v}`);
    return Math.round(n);
  },
  /** ISO-8601 简写/秒数 → unix 秒; 用于把窗口时长换算成 reset_at */
  duration: (v) => {
    if (typeof v === "number") return v;
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(v));
    if (!m) throw new MappingError(`无法解析 duration: ${String(v)}`);
    return (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
  },
  /** ISO 8601 字符串 → unix 秒(容忍毫秒小数与 Z/偏移时区); 数字输入直接过 */
  iso_epoch: (v) => {
    if (typeof v === "number") return Math.floor(v);
    const m = ISO_8601_RE.exec(String(v));
    if (!m) throw new MappingError(`无法解析 ISO 8601: ${String(v)}`);
    const [, Y, Mo, D, H, Mi, S, frac, tz] = m;
    const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
    let offsetMin = 0;
    if (tz && tz !== "Z") {
      const sign = tz.startsWith("-") ? -1 : 1;
      const hm = tz.slice(1).replace(":", "");
      offsetMin = sign * (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(2) || "0"));
    }
    return Math.floor(
      Date.UTC(Number(Y), Number(Mo) - 1, Number(D), Number(H), Number(Mi) - offsetMin, Number(S), ms) / 1000,
    );
  },
  /** 毫秒 epoch(如 zai nextResetTime=1788092761239) → unix 秒; 数字直接 /1000 */
  ms_epoch: (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new MappingError(`无法转 ms_epoch: ${typeof v}`);
    return Math.floor(n / 1000);
  },
  /** 剩余百分比 → 已用百分比: 100 - x(MiniMax token_plan 直给 remaining, 2026-09-01) */
  invert_percent: (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) throw new MappingError(`无法转 invert_percent: ${typeof v}`);
    return Math.max(0, Math.min(100, 100 - n));
  },
};

export function applyPipe(value: unknown, filters: PipeFilter[]): unknown {
  let v = value;
  for (const f of filters) {
    const fn = FILTERS[f];
    if (!fn) throw new MappingError(`过滤器不在白名单: ${f}`);
    v = fn(v);
  }
  return v;
}

// ---- 受限比较表达式(状态断言用, 无 eval) ----
// 形如: "$.status == 'active'" / "$.percent >= 90"
// left 必须是 JSONPath, op ∈ == != < <= > >=, right 是字面量(number/string/boolean)

export type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

export interface ParsedAssertion {
  path: string;
  op: CompareOp;
  literal: number | string | boolean;
}

const ASSERTION_RE =
  /^\s*(\$[A-Za-z0-9_.[\]'"]*?)\s*(==|!=|<=|>=|<|>)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|(true|false))\s*$/;

export function parseAssertion(expr: string): ParsedAssertion {
  const m = ASSERTION_RE.exec(expr);
  if (!m) {
    throw new MappingError(`非法断言表达式(仅支持 <jsonpath> <op> <字面量>): ${expr}`);
  }
  const [, path, op, sq, dq, num, bool] = m;
  let literal: number | string | boolean;
  if (sq !== undefined) literal = sq;
  else if (dq !== undefined) literal = dq;
  else if (num !== undefined) literal = Number(num);
  else literal = bool === "true";
  return { path, op: op as CompareOp, literal };
}

export function evalAssertion(json: unknown, expr: string): boolean {
  const { path, op, literal } = parseAssertion(expr);
  const actual = evalJsonPathFirst(json, path);
  switch (op) {
    case "==":
      // eslint-disable-next-line eqeqeq
      return actual == literal;
    case "!=":
      // eslint-disable-next-line eqeqeq
      return actual != literal;
    case "<":
      return Number(actual) < Number(literal);
    case "<=":
      return Number(actual) <= Number(literal);
    case ">":
      return Number(actual) > Number(literal);
    case ">=":
      return Number(actual) >= Number(literal);
  }
}
