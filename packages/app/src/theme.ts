import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "./types";

/**
 * 主题(D-010): dark/light 双套 CSS 变量, 默认追随系统, 可配置覆盖。
 * 追随系统 = webview 的 prefers-color-scheme(Windows 下 WebView2 跟随 OS 主题);
 * 覆盖持久化 localStorage(P0 后续卡片接入 settings 存储后迁移)。
 */

export type ThemeMode = AppSettings["theme"];
export type EffectiveTheme = "light" | "dark";

const THEME_KEY = "token-wallet.theme.v1";

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

export function useTheme(): {
  mode: ThemeMode;
  effective: EffectiveTheme;
  setMode: (m: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);
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
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(THEME_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  return { mode, effective, setMode };
}
