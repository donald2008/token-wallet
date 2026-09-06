"""TTL 每日维护 — spec §4.3。顺序固定: 先聚合后删除。

- 每日聚合: usage_events 按天 × agent × model 聚合 → usage_records
  (source='agent', provider_id='agent:'||agent_id, window_start/end=当日边界
  epoch 秒, status != 'unknown' 才参与)。
- tokens 列语义 (comment #1092 终审口径): tokens = input_cache_miss + output
  (计费量; cache_hit 只作为 pricing 补 cost 的输入, 不进 tokens 列)。
  → 本卡随实现回写 spec §4.2 该注释。
- TTL: DELETE usage_events WHERE ts_epoch < now - USAGE_TTL_DAYS (缺省 90);
  usage_records 聚合表长期保留, 不参与 TTL。
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from .tzutil import day_bounds, local_tz


def aggregate_day(conn: sqlite3.Connection, day_start_epoch: int, _lock=None) -> int:
    """聚合某一天 (tz 当日 00:00 → 次日 00:00) 的 usage_events → usage_records(source='agent')。

    日界 = daemon 本地时区 (§4.2, 终审 P1: 禁 UTC 硬编码); day_start_epoch
    须为本地时区当日 00:00 的 epoch 秒 (day_bounds 自动归一)。
    返回写入的聚合行数。幂等性: 同 (provider_id, model, window_start) 已有
    source='agent' 行则先删再插 (聚合是派生数据, 重算安全)。
    daemon 运行态传 EventStorage._lock 串行化; 单测直连可省。
    """
    _tz, _ = local_tz()
    day_start_epoch, day_end_epoch = day_bounds(day_start_epoch, _tz)

    def _impl():
        conn.execute("BEGIN")
        try:
            # 派生数据重算: 清掉本窗口已有聚合行 (只清 agent 来源, 不动 cloud 行)
            conn.execute(
                """
                DELETE FROM usage_records
                WHERE source = 'agent'
                  AND window_start = ?
                  AND provider_id IN (
                    SELECT DISTINCT 'agent:' || agent_id FROM usage_events
                     WHERE ts_epoch >= ? AND ts_epoch < ?
                  )
                """,
                (day_start_epoch, day_start_epoch, day_end_epoch),
            )
            cur = conn.execute(
                """
                INSERT INTO usage_records
                    (provider_id, model, window_start, window_end, tokens, credits, cost_cny, source)
                SELECT 'agent:' || agent_id,
                       model,
                       ?,
                       ?,
                       SUM(in_miss_tokens + out_tokens),
                       NULL,
                       -- 价目表为空/无此模型时补算不出 cost → NULL (零成本与
                       -- 无数据不可分, 三层二审 P3); COALESCE 全空表达式自然为 NULL
                       SUM(CASE WHEN total_cost IS NOT NULL THEN total_cost
                                WHEN in_hit_cost IS NOT NULL OR in_miss_cost IS NOT NULL
                                     OR out_cost IS NOT NULL THEN
                                    COALESCE(in_hit_cost, 0) + COALESCE(in_miss_cost, 0)
                                    + COALESCE(out_cost, 0)
                                ELSE NULL END),
                       'agent'
                FROM usage_events
                WHERE ts_epoch >= ? AND ts_epoch < ?
                  AND status != 'unknown'
                GROUP BY agent_id, model
                """,
                (day_start_epoch, day_end_epoch, day_start_epoch, day_end_epoch),
            )
            written = cur.rowcount
            conn.execute("COMMIT")
            return written
        except Exception:
            conn.execute("ROLLBACK")
            raise

    if _lock is not None:
        with _lock:
            return _impl()
    return _impl()


def purge_expired(
    conn: sqlite3.Connection, ttl_days: int, *, now_epoch: int | None = None, _lock=None
) -> int:
    """DELETE usage_events WHERE ts_epoch < now - TTL 天。返回删除行数。"""
    if now_epoch is None:
        now_epoch = int(datetime.now().timestamp())  # epoch 时区无关
    cutoff = now_epoch - ttl_days * 86400

    def _impl():
        cur = conn.execute("DELETE FROM usage_events WHERE ts_epoch < ?", (cutoff,))
        conn.commit()
        return cur.rowcount

    if _lock is not None:
        with _lock:
            return _impl()
    return _impl()


def daily_maintenance(
    conn: sqlite3.Connection, ttl_days: int, *, now: datetime | None = None, _lock=None
) -> dict:
    """每日维护入口 (daemon 本地时区凌晨执行, §4.3): 先聚合前一天, 后按 TTL 删原始。

    「前一天」边界 = daemon 本地时区 (与 §4.2 聚合窗口口径一致)。
    返回 {"aggregated_rows": N, "deleted_events": M} 供验收对账。
    """
    if now is None:
        # daemon 本地时区 (tzutil 解析链: 显式/env/宿主, TOKEN_WALLET_TZ 可覆盖) —
        # 三层二审 P3: 禁 datetime.now().astimezone() 绕过 (与聚合日界口径一致)
        _tz, _ = local_tz()
        now = datetime.now(_tz)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    aggregated = aggregate_day(conn, int(yesterday_start.timestamp()), _lock=_lock)
    deleted = purge_expired(conn, ttl_days, _lock=_lock)
    return {"aggregated_rows": aggregated, "deleted_events": deleted}
