const fs = require("fs");

// 经典齿轮剪影生成器(输出 src/components/gear-path.ts 纯数据, 组件在 icons.tsx 手写)。
// 几何: 外圈齿环(8 短梯形齿) + 中心孔(evenodd 挖空), 坐标以 (0,0) 为心、
// 渲染时 <path transform="translate(8 8)">。齿短而密 → 16px 下与"太阳=圆+放射线"一眼可辨。
const R_TIP = 7.2;   // 齿顶
const R_ROOT = 6.0;  // 齿根
const R_HOLE = 2.6;  // 中心孔
const N = 8;
const TOOTH_HALF_DEG = 12; // 齿顶半角
const ROOT_HALF_DEG = 21;  // 齿根半角(梯形齿侧)

const pt = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
};

const cmds = [];
for (let i = 0; i < N; i++) {
  const c = (i * 360) / N;
  cmds.push(`L ${pt(R_ROOT, c - ROOT_HALF_DEG)}`);
  cmds.push(`L ${pt(R_TIP, c - TOOTH_HALF_DEG)}`);
  cmds.push(`A ${R_TIP} ${R_TIP} 0 0 1 ${pt(R_TIP, c + TOOTH_HALF_DEG)}`);
  cmds.push(`L ${pt(R_ROOT, c + ROOT_HALF_DEG)}`);
  cmds.push(`A ${R_ROOT} ${R_ROOT} 0 0 1 ${pt(R_ROOT, c + 360 / N - ROOT_HALF_DEG)}`);
}
// 外轮廓 + 中心孔(反向小圆), fill-rule=evenodd 挖孔
const d =
  `M ${pt(R_ROOT, -ROOT_HALF_DEG)} ` + cmds.join(" ") + " Z" +
  ` M ${R_HOLE} 0 A ${R_HOLE} ${R_HOLE} 0 1 0 ${R_HOLE} 0.01 Z`;

const out = `/**
 * 本文件由 scripts/gen-gear.cjs 生成(几何参数见该脚本), 勿手改 —— 改几何后重跑:
 *   node scripts/gen-gear.cjs
 * 经典齿轮剪影(⚙): 外圈齿环(8 短梯形齿) + 中心孔。
 * 坐标以 (0,0) 为心(外径 7.2), 渲染时 <path transform="translate(8 8)">; 与
 * icons.tsx 的 ClassicGearIcon 配套使用。16px 渲染下与"太阳=圆+放射线"一眼可辨。
 */

export const GEAR_VIEWBOX = "0 0 16 16";

/** 齿轮外轮廓 + 中心孔双子路径; 必须 fill-rule="evenodd" 挖出中心孔 */
export const CLASSIC_GEAR_PATH =
  "${d}";
`;
fs.writeFileSync("src/components/gear-path.ts", out);
console.log("gear-path.ts written; path", d.length, "chars");
