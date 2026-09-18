import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { dataThemeAttr, loadGlass, loadThemeMode } from "./theme";
import "./theme.css";
import "./app.css";
// t_15397c99: 大屏样式独立文件( Ops Wall 重构) — 必须在 main.tsx import(CSS @import 在文件尾部会被浏览器忽略)
import "./app-dash.css";

/**
 * 首帧前同步主题(D-010/D-016): index.html 不硬编码 data-theme,
 * 在此(React 挂载前)按 配置 > 系统 解析并落到 <html>, 消除浅色系统的深色 FOUC。
 * 必须是本模块顶层副作用, 先于 createRoot.render 执行。
 */
(function prePaintTheme(): void {
  const mode = loadThemeMode();
  const effective =
    mode !== "system"
      ? mode
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = dataThemeAttr(effective, loadGlass());
})();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
