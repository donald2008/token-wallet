"""价目表补算 — spec §1.2。

agent 只保证 tokens 忠实; cost 为 null 时 daemon 按价目表补算
(同模型全集群一口价, USD)。v1: 表格式配置 + 内置空表 + 代码路径,
价目条目后续按 llm-provider-quota 实测数据填充。
"""
from __future__ import annotations

from typing import Optional

# 模型名(小写精确匹配或前缀匹配) → (USD per 1M input_miss, input_hit, output tokens)
# v1 内置空表: 无条目时 cost 保持 null (缺价 ≠ 拒报)
PRICE_TABLE: dict[str, tuple[float, float, float]] = {
    # "glm-5.3-flash": (0.0, 0.0, 0.0),
}

CURRENCY = "USD"


def _lookup_rate(model: str) -> Optional[tuple[float, float, float]]:
    m = (model or "").lower()
    if m in PRICE_TABLE:
        return PRICE_TABLE[m]
    for key, rate in PRICE_TABLE.items():
        if m.startswith(key):
            return rate
    return None


def compute_cost(component: str, tokens: int, model: str) -> tuple[Optional[float], Optional[str]]:
    """单分项补算。返回 (cost, currency); 价目表无此模型 → (None, None)。

    component ∈ input_cache_hit | input_cache_miss | output (hit 通常打折/免费)。
    """
    rate = _lookup_rate(model)
    if rate is None or tokens is None:
        return None, None
    per_m = {"input_cache_hit": rate[1], "input_cache_miss": rate[0], "output": rate[2]}[component]
    cost = tokens * per_m / 1_000_000
    return cost, CURRENCY


def compute_report_costs(report) -> Optional[dict]:
    """整条 report 的 cost 补算 — 纯函数, 不改写 report (raw_json 保持提交原文, §4.1)。

    返回 {("hit"|"miss"|"out"|"total"): (cost, currency)}; 仅含补算出的分项;
    价目表无此模型 / usage=None → None。补算值由 storage 写 *_cost 列并附进
    echo 的 _computed (§2.3), 绝不进入 raw_json (终审 P1 #2)。
    """
    usage = getattr(report, "usage", None)
    if usage is None:
        return None
    computed: dict[str, tuple[float, str]] = {}
    for slot, name in (("hit", "input_cache_hit"), ("miss", "input_cache_miss"), ("out", "output")):
        comp = getattr(usage, name)
        if comp.cost is None:
            cost, currency = compute_cost(name, comp.tokens, report.model)
            if cost is not None:
                computed[slot] = (cost, currency)
    # total.cost 也是 null 时按三分项补算值求和; 任一分项缺价则 total 不补 (宁缺勿错)
    if usage.total.cost is None:
        parts = [computed[s] for s in ("hit", "miss", "out") if s in computed]
        if len(parts) == 3:
            computed["total"] = (
                sum(p[0] for p in parts),
                parts[0][1],
            )
    return computed or None
