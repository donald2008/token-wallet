"""usage_events 存储层 — DDL 权威 = docs/mcp-protocol.md §4.1。

两级判重 (§3): event_id UNIQUE (一级/身份) + fingerprint UNIQUE (二级/内容),
INSERT OR IGNORE, 命中即 duplicated 计数, 不报错。
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

# DDL 全文照抄 spec §4.1 (权威形态, 勿改)
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS usage_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT    NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('completed','partial','unknown')),
  agent_id       TEXT    NOT NULL,
  harness        TEXT    NOT NULL,
  session_id     TEXT,
  ts             TEXT    NOT NULL,
  ts_epoch       INTEGER NOT NULL,
  model          TEXT    NOT NULL DEFAULT '',
  provider       TEXT    NOT NULL DEFAULT '',
  in_hit_tokens  INTEGER, in_hit_cost  REAL, in_hit_currency  TEXT,
  in_miss_tokens INTEGER, in_miss_cost REAL, in_miss_currency TEXT,
  out_tokens     INTEGER, out_cost     REAL, out_currency     TEXT,
  total_cost     REAL,    total_currency TEXT,
  kanban_task    TEXT,
  kind           TEXT    NOT NULL DEFAULT 'other',
  usage_null     INTEGER NOT NULL DEFAULT 0,
  fingerprint    TEXT    NOT NULL UNIQUE,
  raw_json       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_events_time        ON usage_events(ts_epoch);
CREATE INDEX IF NOT EXISTS idx_usage_events_agent_time  ON usage_events(agent_id, ts_epoch);
CREATE INDEX IF NOT EXISTS idx_usage_events_session     ON usage_events(session_id);
"""


def compute_fingerprint(
    *,
    session_id: Optional[str],
    ts_epoch: int,
    model: Optional[str],
    provider: Optional[str],
    hit_tokens: int,
    miss_tokens: int,
    out_tokens: int,
    kind: Optional[str],
    status: str,
) -> str:
    """spec §3 canonical 规则: join("|", [...]) → sha256 hex lowercase。

    status=unknown, usage=null 时三个 tokens 取 0 (调用方保证)。
    """
    canonical = "|".join(
        [
            session_id or "",
            str(int(ts_epoch)),  # ts 截到秒, 与时区写法无关
            model or "",
            provider or "",
            str(hit_tokens),
            str(miss_tokens),
            str(out_tokens),
            kind or "",
            status,
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class EventStorage:
    """usage_events 读写 (daemon 私有 SQLite)。

    线程安全: fastmcp tool handler 跑在与初始化不同的线程 →
    check_same_thread=False + 全部读写经 self._lock 串行化
    (单连接 + 锁, SQLite 单文件低并发场景最简正确形态)。
    """

    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode = WAL;")
        self.conn.execute("PRAGMA foreign_keys = ON;")
        self.conn.execute("PRAGMA busy_timeout = 5000;")
        self.conn.executescript(SCHEMA_SQL)
        self.conn.commit()
        self._ensure_source_column()

    def _ensure_source_column(self) -> None:
        """usage_records 扩列 source (spec §4.2) — 幂等: 先查 pragma table_info。

        注: 本 daemon 自己不建 usage_records (那是 core/app 侧的表), 但 daemon
        库与 app 库同路径同表 (§4: 统一 SQLite), 聚合任务要写它 — 首次打开时
        若表已存在(老库)则补 ALTER, 新库由 core SCHEMA_SQL(已扩列)直接带此列。
        """
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(usage_records)")}
        if not cols:
            return  # 表不存在 — daemon 聚合任务运行时按 core SCHEMA_SQL 建表再写
        if "source" not in cols:
            self.conn.execute(
                "ALTER TABLE usage_records ADD COLUMN source TEXT NOT NULL DEFAULT 'cloud'"
            )
            self.conn.commit()

    def ensure_usage_records_table(self) -> None:
        """聚合写入前确保 usage_records 存在 (DDL 与 core schema-sql.ts 同源等价, 含 source 列)。"""
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS usage_records (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              provider_id TEXT NOT NULL,
              model TEXT,
              window_start INTEGER NOT NULL,
              window_end INTEGER NOT NULL,
              tokens REAL,
              credits REAL,
              cost_cny REAL,
              source TEXT NOT NULL DEFAULT 'cloud'
            );
            CREATE INDEX IF NOT EXISTS idx_usage_provider_time
              ON usage_records(provider_id, window_start);
            """
        )
        self.conn.commit()

    # -- 写入 ---------------------------------------------------------------

    def insert_report(self, report: Any, fingerprint: str, *, computed_costs=None) -> bool:
        """落一条已校验的 UsageReport。返回 False = 命中任一级判重 (duplicated)。

        raw_json = report 原样序列化 = 提交原文 (§4.1 终审 P1 #2: 价目表补算值
        经 computed_costs 参数传入写 *_cost 列, 不改写 report 再序列化);
        computed_costs 形态见 pricing.compute_report_costs。
        """
        usage = report.usage
        usage_null = 1 if usage is None else 0
        hit, miss, out, total = (
            (usage.input_cache_hit, usage.input_cache_miss, usage.output, usage.total)
            if usage is not None else (None, None, None, None)
        )
        cc = computed_costs or {}
        hit_cc, miss_cc, out_cc, total_cc = cc.get("hit"), cc.get("miss"), cc.get("out"), cc.get("total")
        with self._lock:
            cur = self.conn.execute(
                """
                INSERT OR IGNORE INTO usage_events (
                  event_id, schema_version, status, agent_id, harness, session_id,
                  ts, ts_epoch, model, provider,
                  in_hit_tokens, in_hit_cost, in_hit_currency,
                  in_miss_tokens, in_miss_cost, in_miss_currency,
                  out_tokens, out_cost, out_currency,
                  total_cost, total_currency,
                  kanban_task, kind, usage_null, fingerprint, raw_json
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    report.event_id,
                    report.schema_version,
                    report.status,
                    report.agent_id,
                    report.harness,
                    report.session_id,
                    report.ts,
                    int(report.ts_dt.timestamp()),
                    report.model,
                    report.provider,
                    hit.tokens if usage else 0,
                    (hit_cc[0] if hit_cc else (hit.cost if hit else None)) if usage else None,
                    (hit_cc[1] if hit_cc else (hit.currency if hit else None)) if usage else None,
                    miss.tokens if usage else 0,
                    (miss_cc[0] if miss_cc else (miss.cost if miss else None)) if usage else None,
                    (miss_cc[1] if miss_cc else (miss.currency if miss else None)) if usage else None,
                    out.tokens if usage else 0,
                    (out_cc[0] if out_cc else (out.cost if out else None)) if usage else None,
                    (out_cc[1] if out_cc else (out.currency if out else None)) if usage else None,
                    (total_cc[0] if total_cc else (total.cost if total else None)) if usage else None,
                    (total_cc[1] if total_cc else (total.currency if total else None)) if usage else None,
                    report.context.kanban_task,
                    report.context.kind,
                    usage_null,
                    fingerprint,
                    report.model_dump_json(),
                ),
            )
            self.conn.commit()
        return cur.rowcount == 1

    # -- 查询 ---------------------------------------------------------------

    def query_events(
        self,
        *,
        event_id: Optional[str] = None,
        session_id: Optional[str] = None,
        since_epoch: Optional[int] = None,
        until_epoch: Optional[int] = None,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """echo 查询: 返回 (events, total_count) — total 不受 limit 影响 (§2.3)。"""
        where, params = [], []
        if event_id:
            where.append("event_id = ?")
            params.append(event_id)
        if session_id:
            where.append("session_id = ?")
            params.append(session_id)
        if since_epoch is not None:
            where.append("ts_epoch >= ?")
            params.append(since_epoch)
        if until_epoch is not None:
            where.append("ts_epoch <= ?")
            params.append(until_epoch)
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        with self._lock:
            total = self.conn.execute(
                f"SELECT COUNT(*) AS c FROM usage_events{clause}", params
            ).fetchone()["c"]
            rows = self.conn.execute(
                f"SELECT raw_json, ts_epoch, provider, model, status, kind, "
                f"kanban_task, "
                f"in_hit_cost, in_hit_currency, in_miss_cost, in_miss_currency, "
                f"out_cost, out_currency, total_cost, total_currency "
                f"FROM usage_events{clause} "
                "ORDER BY ts_epoch DESC, id DESC LIMIT ?",
                [*params, limit],
            ).fetchall()
        events = []
        for r in rows:
            raw = json.loads(r["raw_json"])
            events.append(self.attach_computed(raw, r))
        return events, total

    @staticmethod
    def attach_computed(raw: dict[str, Any], row: sqlite3.Row) -> dict[str, Any]:
        """附 daemon 补齐的 computed 字段 (§2.3), 不写回 raw_json 原文。

        fingerprint 照 §3 规则从原文重算; *_computed_cost = 价目表补算值
        (列里非空价与原文价同值时不重复输出, 仅补算出的才附)。
        """
        usage = raw.get("usage")
        computed: dict[str, Any] = {}
        if isinstance(usage, dict):
            hit = (usage.get("input_cache_hit") or {}).get("tokens") or 0
            miss = (usage.get("input_cache_miss") or {}).get("tokens") or 0
            out = (usage.get("output") or {}).get("tokens") or 0
            computed["tokens_billable"] = miss + out
            computed["fingerprint"] = compute_fingerprint(
                session_id=raw.get("session_id"),
                ts_epoch=row["ts_epoch"],
                model=raw.get("model") or row["model"],
                provider=raw.get("provider") or row["provider"],
                hit_tokens=hit,
                miss_tokens=miss,
                out_tokens=out,
                kind=(raw.get("context") or {}).get("kind"),
                status=raw.get("status") or row["status"],
            )
            # 补算 cost: 列值 ≠ 原文价 (原文价 null 而列非空) → 附补算值 (§2.3)
            for slot, c_col, cur_col in (
                ("input_cache_hit", "in_hit_cost", "in_hit_currency"),
                ("input_cache_miss", "in_miss_cost", "in_miss_currency"),
                ("output", "out_cost", "out_currency"),
                ("total", "total_cost", "total_currency"),
            ):
                db_cost, db_cur = row[c_col], row[cur_col]
                comp = usage.get(slot) or {}
                if db_cost is not None and comp.get("cost") is None:
                    computed.setdefault("computed_cost", {})[slot] = {
                        "cost": db_cost, "currency": db_cur,
                    }
        return {"_computed": computed, **raw}
