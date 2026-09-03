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

/** 落 <html data-theme>: 玻璃开关开启 → <base>-glass 变体(透明底 + backdrop-filter) */
export function dataThemeAttr(effective: EffectiveTheme, glass: boolean): string {
  return glass ? `${effective}-glass` : effective;
}

export function useTheme(): {
  mode: ThemeMode;
  effective: EffectiveTheme;
  glass: boolean;
  setMode: (m: ThemeMode) => void;
  setGlass: (g: boolean) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);
  const [glass, setGlassState] = useState<boolean>(loadGlass);
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

  return { mode, effective, glass, setMode, setGlass };
}
