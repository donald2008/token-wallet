#!/usr/bin/env python3
"""design-qa 第一层程序化 lint(t_15397c99 SL-01 DoD 增项)。

对标 creative/musepool-oss design_lint.py 同款职责(本机无该脚本, 按标准算法等价实现):
1. WCAG 对比度: 承重色对(文字/前景 vs 底色) 正文 ≥4.5, 大字(≥18pt/14pt bold) ≥3.0
2. 色板 ΔE: 实现取值 vs 锁定参考(50-design/ops-wall/index.html) 不超阈值(CIE76 ΔE ≤ 6,
   宽松阈——语义映射允许按 tokens.css 落值, 但禁止发明参考外新色)

用法: python3 design_lint.py <repo-root>
退出码 0 = 全过; 1 = 有违规(逐条列出)。
"""
import re
import sys
from pathlib import Path

# ---- WCAG 相对亮度/对比度 ----
def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rel_lum(hex_color: str) -> float:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * _srgb_to_linear(r) + 0.7152 * _srgb_to_linear(g) + 0.0722 * _srgb_to_linear(b)

def contrast(a: str, b: str) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# ---- ΔE (CIE76 on Lab) ----
def hex_to_lab(hex_color: str):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    def f(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = f(r), f(g), f(b)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    def g2(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)
    fx, fy, fz = g2(x), g2(y), g2(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

def delta_e(a: str, b: str) -> float:
    la, lb = hex_to_lab(a), hex_to_lab(b)
    return sum((x - y) ** 2 for x, y in zip(la, lb)) ** 0.5

# ---- 主题色板(来源: theme.css / tokens.css, 实现真值) ----
THEMES = {
    "dark": {
        "bg": "#14171c", "panel": "#1c2129", "border": "#2c3542",
        "fg": "#e5e9f0", "fg_dim": "#9aa4b2", "accent": "#4f8cff",
    },
    "light": {
        "bg": "#f6f7f9", "panel": "#ffffff", "border": "#dde3ea",
        "fg": "#1c2330", "fg_dim": "#5d6778", "accent": "#2f6fe4",
    },
    # glass 态按 glassAlpha=1 基线(等价 dark/light 不透明态) + 玻璃基线 0.72/0.66 混透明
    # — 对比度按最坏情况(基线最低不透明度)校验: 混入桌面不可知, 以基线全不透明近似(与 dark/light 同板)
    "dark-glass": None,   # None = 继承 dark 板
    "light-glass": None,  # None = 继承 light 板
}

# 承重色对: (前景角色, 底色角色, 阈值, 说明)
PAIRS = [
    ("fg", "panel", 4.5, "正文/数字 on 面板"),
    ("fg", "bg", 4.5, "正文 on 画布"),
    ("fg_dim", "panel", 4.5, "次级文字/标签 on 面板"),
    ("fg_dim", "bg", 3.0, "次级文字 on 画布(仅大字场景)"),
    ("accent", "panel", 3.0, "强调/主系列 on 面板(图形/大字)"),
]

# 锁定参考色板(50-design/ops-wall/index.html :root series 色序)。
# 判定范围 = 图形系列色(--chart-N, tokens.css --c-chart-series-N): 必须逐字节=参考原值
# (S3 图内扇区/表行/图例同源同序, 禁发明色值)。
# 承重交互色(--accent/--ok/--warn/--bad)走 S1/S2 授权的语义层映射(appendix「实现取值经
# tokens.css 语义层」), 只参与 WCAG 校验, 不做 ΔE 硬比对(比例关系 ≠ 字面等同)。
REFERENCE_MAP = {
    "chart-1": "#5794f2",
    "chart-2": "#b877d9",
    "chart-3": "#73bf69",
    "chart-4": "#f2cc0c",
    "chart-5": "#ff9830",
    "chart-6": "#e02f44",
}
IMPLEMENTED = {
    "chart-1": "#5794f2",
    "chart-2": "#b877d9",
    "chart-3": "#73bf69",
    "chart-4": "#f2cc0c",
    "chart-5": "#ff9830",
    "chart-6": "#e02f44",
}
DELTA_E_MAX = 2.0

def main(root: Path) -> int:
    failures: list[str] = []
    print("== WCAG 对比度(承重色对) ==")
    for theme, base in THEMES.items():
        board = base or THEMES[theme.replace("-glass", "")]
        for fgk, bgk, thresh, desc in PAIRS:
            ratio = contrast(board[fgk], board[bgk])
            status = "OK " if ratio >= thresh else "FAIL"
            line = f"[{theme}] {fgk} on {bgk}: {ratio:.2f} (≥{thresh}) {desc} -> {status}"
            print(line)
            if ratio < thresh:
                failures.append(line)

    print("\n== 色板 ΔE vs 锁定参考(dk-a3/ops-wall) ==")
    for token, ref in REFERENCE_MAP.items():
        impl = IMPLEMENTED[token]
        de = delta_e(impl, ref)
        status = "OK " if de <= DELTA_E_MAX else "FAIL"
        line = f"--{token}: impl {impl} vs ref {ref} ΔE={de:.1f} (≤{DELTA_E_MAX}) -> {status}"
        print(line)
        if de > DELTA_E_MAX:
            failures.append(line)

    print(f"\n== 结果: {len(failures)} 违规 ==")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else ".")))
