/**
 * 通道目录浏览器安全桶导出 — DESIGN.md §5 (D-025)
 *
 * 只含声明式数据(descriptor + mapping), 零 Node 依赖, app 可经 subpath export 接入。
 */
export * from "./descriptor.js";
export * from "./presets.js";
export * from "./registry.js";
export * from "./deepseek.js";
