#!/usr/bin/env python3
"""DTCG 三层 alias 全量解析验证: primitives→semantic→components 所有引用必须可解析, 无环, 无悬空。

用法: python3 validate_aliases.py   (在 docs/design-tokens/ 目录下运行)
"""
import json, sys, functools, re
from pathlib import Path

DIR = Path(__file__).resolve().parent
prims = json.loads((DIR / "primitives.tokens.json").read_text(encoding="utf-8"))
sem   = json.loads((DIR / "semantic.tokens.json").read_text(encoding="utf-8"))
comp  = json.loads((DIR / "components.tokens.json").read_text(encoding="utf-8"))


def deep_merge(*dicts):
    def merge(a, b):
        out = dict(a)
        for k, v in b.items():
            if k in out and isinstance(out[k], dict) and isinstance(v, dict):
                out[k] = merge(out[k], v)
            else:
                out[k] = v
        return out
    return functools.reduce(merge, dicts, {})


ALL = deep_merge(prims, sem, comp)


def flatten(node, prefix=""):
    out = {}
    for k, v in node.items():
        if not isinstance(v, dict):
            continue
        key = f"{prefix}.{k}" if prefix else k
        if "$value" in v:
            out[key] = v
        else:
            out.update(flatten(v, key))
    return out


tokens = flatten(ALL)
ALIAS = re.compile(r"\{([a-zA-Z0-9.-]+)\}")

errors, ok_count = [], 0
for path, tok in tokens.items():
    val = tok.get("$value")
    if isinstance(val, str) and "{" in val:
        for ref in ALIAS.findall(val):
            if ref not in tokens:
                errors.append(f"{path} -> UNRESOLVED {{{ref}}}")
            else:
                ok_count += 1

print(f"tokens={len(tokens)}  alias refs resolved={ok_count}  errors={len(errors)}")
if errors:
    for e in errors[:40]:
        print(" ", e)
    sys.exit(1)
print("✔ 全部 alias 可解析, 无悬空引用")

# 无环检查
try:
    import networkx as nx
except ImportError:
    # 极简环检测: 深搜
    G = {path: [] for path in tokens}
    for path, tok in tokens.items():
        val = tok.get("$value")
        if isinstance(val, str):
            for ref in ALIAS.findall(val):
                if ref in G and ref != path:
                    G[path].append(ref)
    # 拓扑排序 Kahn
    indeg = {n: 0 for n in G}
    for n in G:
        for m in G[n]:
            indeg[m] += 1
    q = [n for n in indeg if indeg[n] == 0]
    visited = 0
    while q:
        n = q.pop()
        visited += 1
        for m in G[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                q.append(m)
    if visited != len(G):
        print("✗ CIRCULAR reference (DAG 检测失败)"); sys.exit(1)
else:
    G = nx.DiGraph()
    for path, tok in tokens.items():
        val = tok.get("$value")
        if isinstance(val, str):
            for ref in ALIAS.findall(val):
                if ref in tokens:
                    G.add_edge(path, ref)
    try:
        nx.find_cycle(G)
        print("✗ CIRCULAR reference"); sys.exit(1)
    except nx.NetworkXNoCycle:
        pass
print("✔ 无循环引用")
print("✔ DTCG 三层完整性验证通过")