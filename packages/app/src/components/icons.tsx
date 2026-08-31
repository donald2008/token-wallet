import type { ThemeMode } from "../theme";
import { CLASSIC_GEAR_PATH, GEAR_VIEWBOX } from "./gear-path";

/**
 * 手绘 SVG 图标(D-002 不引图标库)。
 * - ClassicGearIcon: 经典齿轮剪影(外圈齿环 + 中心孔), 几何由 scripts/gen-gear.cjs
 *   预生成(gear-path.ts) —— 真机复验(t_66b67453 契约3): 旧"中心圆+八向长齿"16px 下
 *   观感=小太阳, 换齿环剪影后与太阳(圆+放射线)一眼可辨。
 * - ThemeQuickIcon: 主题快切钮三态图标(真机复验契约2), 随 themeMode 切换:
 *   system=半日半月(半盘实心 + 四向短线) / light=太阳(实心圆 + 八向放射线) /
 *   dark=月亮(crescent)。太阳与齿轮的区分 = 放射线 vs 齿环, 无外环。
 */

/** 经典齿轮: 齿环剪影(fill evenodd 挖中心孔), 坐标以 (0,0) 为心 → translate(8 8) */
export function ClassicGearIcon() {
  return (
    <svg width="16" height="16" viewBox={GEAR_VIEWBOX} aria-hidden="true" focusable="false">
      <path
        d={CLASSIC_GEAR_PATH}
        transform="translate(8 8)"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

/** 太阳(light): 实心圆 + 八向放射线(无外环 —— 与齿轮齿环剪影区分) */
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      <path
        d="M8 1.1v1.7M8 13.2v1.7M1.1 8h1.7M13.2 8h1.7M3.19 3.19l1.42 1.42M11.39 11.39l1.42 1.42M12.81 3.19l-1.42 1.42M4.61 11.39l-1.42 1.42"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 月亮(dark): crescent(lucide/feather moon 等比缩放到 16 栅格) */
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 跟随系统: 半日半月 —— 圆盘右半实心(日) + 左半描边(月), 仅四向短线(与 light 八线区分) */
function HalfSunMoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 5a3 3 0 0 1 0 6z" fill="currentColor" />
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.1v1.7M8 13.2v1.7M1.1 8h1.7M13.2 8h1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 主题快切钮图标: 图标反映当前 mode(契约2) */
export function ThemeQuickIcon({ mode }: { mode: ThemeMode }) {
  if (mode === "light") return <SunIcon />;
  if (mode === "dark") return <MoonIcon />;
  return <HalfSunMoonIcon />;
}
