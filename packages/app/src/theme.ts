import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "./types";
import { t } from "./i18n";

/**
 * 主题(D-010): dark/light 双套 CSS 变量, 默认追随系统, 可配置覆盖。
 * 追随系统 = webview 的 prefers-color-scheme(Windows 下 WebView2 跟随 OS 主题);
 * 覆盖持久化 localStorage(P0 后续卡片接入 settings 存储后迁移)。
 */

export type ThemeMode = AppSettings["theme"];
export type EffectiveTheme = "light" | "dark";

/** 主题快切循环(t_66b67453 契约2): 自动 → 浅色 → 深色 → 自动; 设置弹窗三态与快切同走此序 */
export const THEME_CYCLE: readonly ThemeMode[] = ["system", "light", "dark"] as const;

/** ThemeMode 标签键(侧栏快切钮 title / aria-label 用, 与设置页文案同源);
 * 值为 i18n 键, 渲染时 themeLabel() 按当前语言取文案(D-047) */
export const THEME_LABEL: Record<ThemeMode, string> = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
};

/** 主题文案(渲染用): 侧栏快切 title/aria 与设置页三档共用 */
export function themeLabel(m: ThemeMode): string {
  return t(THEME_LABEL[m] as Parameters<typeof t>[0]);
}

const THEME_KEY = "token-wallet.theme.v1";
const GLASS_KEY = "token-wallet.glass.v1";
/** 玻璃 alpha 持久化键(t_c20d4d11 9/7 用户拍板: 透明度滑槽, 默认 1.0 不透明)。
 * 独立 key 不与 GLASS_KEY 合并 —— 关闭玻璃时 alpha 设置保留, 切回玻璃恢复。 */
const GLASS_ALPHA_KEY = "token-wallet.glassAlpha.v1";
/** 默认 alpha = 1.0(不透明): 用户不碰滑槽时玻璃面板与普通主题观感一致,
 * 仅主动拖滑槽降低 alpha 才出现半透明玻璃感。下限 0.15 保可读性。
 * 导出供 SettingsView 滑槽 min/max 绑定 + persistGlassAlpha 边界裁剪 */
export const GLASS_ALPHA_MIN = 0.15;
export const GLASS_ALPHA_MAX = 1;
const GLASS_ALPHA_DEFAULT = 1;

function systemTheme(): EffectiveTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function loadThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* 隐私模式忽略 */
  }
  return "system";
}

export function loadGlass(): boolean {
  try {
    return localStorage.getItem(GLASS_KEY) === "1";
  } catch {
    return false;
  }
}

/** 读玻璃透明度(alpha 0.15~1); 旧用户无值/越界值/隐私模式都回退默认 1.0(不透明)。 */
export function loadGlassAlpha(): number {
  try {
    const v = localStorage.getItem(GLASS_ALPHA_KEY);
    const n = v == null ? NaN : Number(v);
    if (Number.isFinite(n) && n >= GLASS_ALPHA_MIN && n <= GLASS_ALPHA_MAX) return n;
  } catch {
    /* 隐私模式忽略 */
  }
  return GLASS_ALPHA_DEFAULT;
}

/** 落 <html data-theme>: 玻璃开关开启 → <base>-glass 变体(透明底 + backdrop-filter) */
export function dataThemeAttr(effective: EffectiveTheme, glass: boolean): string {
  return glass ? `${effective}-glass` : effective;
}

export function useTheme(): {
  mode: ThemeMode;
  effective: EffectiveTheme;
  glass: boolean;
  glassAlpha: number;
  setMode: (m: ThemeMode) => void;
  setGlass: (g: boolean) => void;
  /** 设玻璃透明度(0.15~1); 设置即写入 --glass-alpha CSS 变量, 玻璃面板背景实时变。
   * 默认 1.0 = 不透明(与普通主题观感一致), 0.15 = 最透明白字仍可读下限。 */
  setGlassAlpha: (a: number) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);
  const [glass, setGlassState] = useState<boolean>(loadGlass);
  const [glassAlpha, setGlassAlphaState] = useState<number>(loadGlassAlpha);
  const [sys, setSys] = useState<EffectiveTheme>(systemTheme);

  // 追随系统: 监听 OS 主题切换
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSys(systemTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const effective: EffectiveTheme = mode === "system" ? sys : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = dataThemeAttr(effective, glass);
  }, [effective, glass]);

  // 玻璃透明度落 <html style="--glass-alpha">: theme.css 用 color-mix(in srgb, var(--c-glass-*) calc(<alpha>*X%), transparent)
  // 计算真实背景色; 默认 1.0 = 不透明(同普通主题), 0.15 = 最透明白字仍可读下限。
  // 关闭 glass 时 alpha 仍写(保留设置), 下次切回玻璃恢复。
  useEffect(() => {
    document.documentElement.style.setProperty("--glass-alpha", glassAlpha.toString());
  }, [glassAlpha]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const setGlass = useCallback((g: boolean) => {
    setGlassState(g);
    try {
      localStorage.setItem(GLASS_KEY, g ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const setGlassAlpha = useCallback((a: number) => {
    const clamped = Math.max(GLASS_ALPHA_MIN, Math.min(GLASS_ALPHA_MAX, a));
    setGlassAlphaState(clamped);
    // 实时写 CSS 变量; 但不立即持久化(由 SettingsView 的 onPointerUp/onBlur 触发)
    // —— 这与 t_c20d4d11 任务「拖即变、停即存」一致: 拖动期间仅写 CSS, 停手落 localStorage。
  }, []);

  return { mode, effective, glass, glassAlpha, setMode, setGlass, setGlassAlpha };
}

/** 滑槽提交(松手/失焦)时把当前 alpha 落 localStorage */
export function persistGlassAlpha(a: number): void {
  try {
    const clamped = Math.max(GLASS_ALPHA_MIN, Math.min(GLASS_ALPHA_MAX, a));
    localStorage.setItem(GLASS_ALPHA_KEY, clamped.toString());
  } catch {
    /* ignore */
  }
}
