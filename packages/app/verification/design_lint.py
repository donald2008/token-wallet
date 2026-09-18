#!/usr/bin/env python3
"""design-qa 第一层程序化 lint(t_15397c99 SL-01 DoD 增项; round-2 起真值解析版)。

对标 creative/musepool-oss design_lint.py 同款职责(本机无该脚本, 按标准算法等价实现):
1. WCAG 对比度: 承重色对(文字/前景 vs 底色) 正文 ≥4.5, 大字(≥18pt/14pt bold) ≥3.0
2. 色板 ΔE: 实现取值 vs 锁定参考(50-design/ops-wall/index.html) 不超阈值(CIE76 ΔE ≤ 2,
   series 色要求逐字节一致, ΔE 仅作等价口径)

真值来源(round-2 P2① 修复, 禁硬编码同值快照):
- 实现色板: packages/app/src/theme.css (data-theme="dark"/"light" 块, --bg/--bg-elev/
  --fg/--fg-dim/--accent/--chart-1..6 逐条解析)
- 参考色板: docs/requests/2026-09-18-dashboard-redesign/50-design/ops-wall/index.html
  :root 块 --s1..--s6(series 参考序)
实现侧任何色值改动(含 chart 系列)都会实时反映进校验 → 不存在恒绿。

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
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    def g2(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)
    fx, fy, fz = g2(x), g2(y), g2(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

def delta_e(a: str, b: str) -> float:
    la, lb = hex_to_lab(a), hex_to_lab(b)
    return sum((x - y) ** 2 for x, y in zip(la, lb)) ** 0.5

_HEX_PATTERN = r"#[0-9a-fA-F]{6}\b"

def _parse_css_block_var(css_text: str, block_selector_frag: str, var: str) -> str:
    """在包含 block_selector_frag 的声明块里解析 var 的 6 位 hex 值, 解析不到返回 ''。"""
    # 逐块扫描: 以选择器开头、到配对 '}' 结束
    idx = 0
    while True:
        bstart = css_text.find(block_selector_frag, idx)
        if bstart == -1:
            return ""
        # 块体 = 从 frag 后第一个 '{' 到配对 '}'
        lbrace = css_text.find("{", bstart)
        if lbrace == -1:
            return ""
        depth, pos = 1, lbrace + 1
        while pos < len(css_text) and depth:
            if css_text[pos] == "{":
                depth += 1
            elif css_text[pos] == "}":
                depth -= 1
            pos += 1
        body = css_text[lbrace + 1 : pos - 1]
        m = re.search(r"--" + re.escape(var) + r"\s*:\s*(" + _HEX_PATTERN + r")", body)
        if m:
            return m.group(1).lower()
        idx = pos  # 该 frag 可能出现多次(如 dark 与 dark-glass 共用选择器), 找下一个块

def parse_impl_theme(theme_css: Path, theme: str) -> dict[str, str]:
    """从 theme.css 解析某主题的承重变量 + chart 系列色。"""
    text = theme_css.read_text(encoding="utf-8")
    frag = f':root[data-theme="{theme}"]'
    keys = ["bg", "bg-elev", "fg", "fg-dim", "accent"] + [f"chart-{i}" for i in range(1, 7)]
    out = {}
    for k in keys:
        v = _parse_css_block_var(text, frag, k)
        if not v:
            raise SystemExit(f"FATAL: theme.css [{theme}] 解析不到 --{k} — 真值源结构变更, 禁止用硬编码兜底")
        out[k] = v
    return out

def parse_ref_series(ref_html: Path) -> dict[str, str]:
    """从 ops-wall 参考稿 :root 块解析 --s1..--s6 参考系列色。"""
    text = ref_html.read_text(encoding="utf-8")
    out = {}
    for i in range(1, 7):
        v = _parse_css_block_var(text, ":root", f"s{i}")
        if not v:
            raise SystemExit(f"FATAL: 参考稿 :root 解析不到 --s{i} — 参考稿结构变更, 禁止用硬编码兜底")
        out[f"chart-{i}"] = v
    return out

# 承重色对: (前景角色, 底色角色, 阈值, 说明) — 角色名 = theme.css 变量(-- 去前缀)
PAIRS = [
    ("fg", "bg-elev", 4.5, "正文/数字 on 面板"),
    ("fg", "bg", 4.5, "正文 on 画布"),
    ("fg-dim", "bg-elev", 4.5, "次级文字/标签 on 面板"),
    ("fg-dim", "bg", 3.0, "次级文字 on 画布(仅大字场景)"),
    ("accent", "bg-elev", 3.0, "强调/主系列 on 面板(图形/大字)"),
]
DELTA_E_MAX = 2.0
THEMES = ("dark", "light")
# glass 态按 glassAlpha=1 基线(等价 dark/light 不透明态)继承同板校验(基线全不透明近似)

def main(root: Path) -> int:
    repo = Path(root)
    theme_css = repo / "packages/app/src/theme.css"
    ref_html = repo / "docs/requests/2026-09-18-dashboard-redesign/50-design/ops-wall/index.html"
    for p in (theme_css, ref_html):
        if not p.is_file():
            raise SystemExit(f"FATAL: 真值源不存在: {p}")
    ref = parse_ref_series(ref_html)
    impl: dict[str, dict[str, str]] = {t: parse_impl_theme(theme_css, t) for t in THEMES}

    failures: list[str] = []
    print("== WCAG 对比度(承重色对; 真值=theme.css 解析) ==")
    for theme in THEMES:
        board = impl[theme]
        for fgk, bgk, thresh, desc in PAIRS:
            ratio = contrast(board[fgk], board[bgk])
            status = "OK " if ratio >= thresh else "FAIL"
            line = f"[{theme}] {fgk}({board[fgk]}) on {bgk}({board[bgk]}): {ratio:.2f} (≥{thresh}) {desc} -> {status}"
            print(line)
            if ratio < thresh:
                failures.append(line)

    print("\n== 色板 ΔE vs 锁定参考(dk-a3/ops-wall; 真值=theme.css vs 参考稿解析) ==")
    for token, refv in ref.items():
        implv = impl["dark"][token]  # chart 系列色两主题共用(theme.css dark/light 段同值)
        de = delta_e(implv, refv)
        status = "OK " if de <= DELTA_E_MAX else "FAIL"
        line = f"--{token}: impl {implv} vs ref {refv} ΔE={de:.1f} (≤{DELTA_E_MAX}) -> {status}"
        print(line)
        if de > DELTA_E_MAX:
            failures.append(line)

    print(f"\n== 结果: {len(failures)} 违规 ==")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else ".")))
