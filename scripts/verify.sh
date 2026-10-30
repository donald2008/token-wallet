#!/usr/bin/env bash
# token-wallet 统一验证入口 v1 (2026-10-30)
#
# 一条命令串起 Linux 可跑的全部验证层，产出机器可读报告：
#   S0 环境预检 → S1 typecheck → S2 core 单测 → S3 app 单测
#   → S4 L2 e2e(browser-only) → S5 build → S6 MCP pytest(venv)
#   → S7 MCP 语法编译冒烟
#   S8/S9/S10 = L2.5 真壳 / L3 真通道 / L4 Windows 冒烟 → 显式 skip + 原因
#
# 纪律（TESTING.md）：
#   - 未运行的层写 skip + 原因，禁写"通过"；
#   - 报告是唯一汇总出口，stdout 只是给人看的摘要；
#   - 报告可随时重生成，不入库。
#
# 用法:
#   scripts/verify.sh            # 全量（含 build）
#   scripts/verify.sh --fast     # 跳过 build（MCP venv 存在时仍跑 pytest）
#
# 退出码: 0 = 无 fail；1 = 有 fail（skip 不算失败）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

REPORT_DIR="$ROOT/verification"
REPORT="$REPORT_DIR/verify-report.json"
OUT_DIR="$REPORT_DIR/verify-logs"
mkdir -p "$OUT_DIR"

STARTED="$(date -Is)"
declare -a STEP_LINES   # id|name|status|exit|dur|note

run_step() {  # id name cmd...
  local id="$1" name="$2"; shift 2
  local log="$OUT_DIR/$id.log"
  local t0=$SECONDS
  printf '▶ %-18s %s\n' "$id" "$name"
  if "$@" >"$log" 2>&1; then
    local st=pass rc=0
  else
    local st=fail rc=$?
  fi
  local dur=$((SECONDS - t0))
  STEP_LINES+=("$id|$name|$st|$rc|$dur")
  printf '  %s  (%ds)  log: %s\n' "${st^^}" "$dur" "$log"
  return $rc
}

skip_step() {  # id name reason
  STEP_LINES+=("$1|$2|skip|-|0|$3")
  printf '◌ %-18s %s  [skip] %s\n' "$1" "$2" "$3"
}

echo "== token-wallet verify v1 == $(date -Is)  fast=$FAST"
echo

# ── S0 环境预检 ───────────────────────────────────────────────
ENV_NOTE=""
MISSING=()
command -v pnpm   >/dev/null || MISSING+=("pnpm")
command -v node   >/dev/null || MISSING+=("node")
command -v python3 >/dev/null || MISSING+=("python3")
[ ${#MISSING[@]} -gt 0 ] && ENV_NOTE="缺工具: ${MISSING[*]}"
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "✗ 环境缺工具: ${MISSING[*]} — 终止"
  exit 1
fi
NODE_V="$(node -v)"; PNPM_V="$(pnpm -v)"; PY_V="$(python3 -V 2>&1)"
echo "env: node=$NODE_V pnpm=$PNPM_V $PY_V"
[ -d node_modules ] || { echo "✗ node_modules 缺失 — 先 pnpm install"; exit 1; }
MCP_VENV="$ROOT/packages/mcp-server/.venv/bin/python"
HAS_MCP_VENV=0; [ -x "$MCP_VENV" ] && HAS_MCP_VENV=1
echo

# ── 各步 ─────────────────────────────────────────────────────
GIT_DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
# 跑前快照：verification 截图基线（跑后只还原本轮新弄脏的，不动跑前已脏的）
PRE_SHOTS="$(mktemp)"
git status --porcelain -- verification packages/app/verification | awk '{print $2}' | sort > "$PRE_SHOTS"

run_step S1 "typecheck (core+app)"  pnpm -r typecheck
S1_RC=$?
run_step S2 "L1 core unit (vitest)" pnpm --filter core test
S2_RC=$?
run_step S3 "app unit (vitest)"     pnpm --filter app test
S3_RC=$?
run_step S4 "L2 e2e browser-only"   pnpm -C packages/app exec playwright test --project=browser-only
S4_RC=$?

if [ "$FAST" -eq 1 ]; then
  skip_step S5 "build (pnpm -r)" "--fast 跳过"
else
  run_step S5 "build (pnpm -r)"     pnpm -r build
  S5_RC=$?
fi

if [ "$HAS_MCP_VENV" -eq 1 ]; then
  run_step S6 "MCP pytest (venv)" bash -c "cd packages/mcp-server && '$MCP_VENV' -m pytest tests/ -q"
else
  skip_step S6 "MCP pytest (venv)" ".venv 未建（README §51：python3 -m venv .venv && pip install -e .）"
fi
S7_T0=$SECONDS
( cd packages/mcp-server && python3 -m compileall -q src ) >"$OUT_DIR/S7.log" 2>&1
S7_RC=$?
S7_DUR=$((SECONDS - S7_T0))
if [ $S7_RC -eq 0 ]; then S7_ST=pass; else S7_ST=fail; fi
STEP_LINES+=("S7|MCP compile smoke|$S7_ST|$S7_RC|$S7_DUR")
printf '▶ %-18s %s\n  %s  (仅语法编译，非导入级)\n' "S7" "MCP compile smoke" "${S7_ST^^}"

# ── 还原本轮新弄脏的 verification 截图（e2e 重写基线的像素噪声）──
POST_SHOTS="$(mktemp)"
git status --porcelain -- verification packages/app/verification | awk '{print $2}' | sort > "$POST_SHOTS"
REVERTED=0
while IFS= read -r f; do
  git checkout -- "$f" && REVERTED=$((REVERTED + 1))
done < <(comm -13 "$PRE_SHOTS" "$POST_SHOTS")
rm -f "$PRE_SHOTS" "$POST_SHOTS"
[ "$REVERTED" -gt 0 ] && echo "↩ 已还原本轮 e2e 重写的截图基线 $REVERTED 个（跑前已脏的不动）"

# ── 非 Linux 层：显式 skip，不冒充通过 ──────────────────────
skip_step S8 "L2.5 真壳视觉"  "仅 Windows 本机（spec 内 platform 守卫）"
skip_step S9 "L3 真通道"      "半自动：golden sample / 真 key 手动验证"
skip_step S10 "L4 Windows 冒烟" "人肉清单，发版前执行"

# ── 汇总报告（机器可读） ─────────────────────────────────────
STEPS_FILE="$OUT_DIR/steps.txt"
printf '%s\n' "${STEP_LINES[@]}" > "$STEPS_FILE"
python3 - "$REPORT" "$STARTED" "$FAST" "$NODE_V" "$PNPM_V" "$PY_V" "$GIT_DIRTY" $HAS_MCP_VENV "$STEPS_FILE" <<'PYEOF'
import json, re, sys
from datetime import datetime
from pathlib import Path
import subprocess

(report, started, fast, node_v, pnpm_v, py_v, dirty, has_venv, steps_path) = (
    sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4], sys.argv[5],
    sys.argv[6], int(sys.argv[7]), sys.argv[8] == "1", sys.argv[9])
root = Path(report).parent.parent
logdir = root / "verification" / "verify-logs"

steps = []
counts_pat = re.compile(r"(\d+)\s+passed")
for line in Path(steps_path).read_text().splitlines():
    sid, name, status, rc, dur, *rest = line.split("|")
    note = rest[0] if rest else ""
    summary = ""
    if status in ("pass", "fail"):
        log = logdir / f"{sid}.log"
        if log.exists():
            tail = log.read_text(errors="replace")[-3000:]
            m = counts_pat.search(tail)
            if m:
                summary = f"{m.group(1)} passed"
            else:
                last = [l for l in tail.strip().splitlines() if l.strip()]
                summary = last[-1][:120] if last else ""
    steps.append({"id": sid, "name": name, "status": status,
                  "exit_code": None if rc == "-" else int(rc),
                  "duration_s": int(dur), "summary": summary, "note": note})

verdict = "fail" if any(s["status"] == "fail" for s in steps) else "pass"
doc = {
    "schema": "token-wallet.verify/v1",
    "started_at": started,
    "finished_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    "mode": "fast" if fast else "full",
    "env": {"node": node_v, "pnpm": pnpm_v, "python": py_v, "mcp_venv": bool(has_venv)},
    "git": {"branch": subprocess.run(
        ["git", "branch", "--show-current"], capture_output=True, text=True,
        cwd=str(root)).stdout.strip(),
        "dirty_files": dirty},
    "steps": steps,
    "totals": {k: sum(1 for s in steps if s["status"] == k) for k in ("pass", "fail", "skip")},
    "verdict": verdict,
}
Path(report).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
print(f"\nreport → {report}")
PYEOF

# ── 人读摘要 ─────────────────────────────────────────────────
echo
echo "== 摘要 =="
printf '%-4s %-22s %-6s %s\n' ID STEP 状态 说明
for line in "${STEP_LINES[@]}"; do
  IFS='|' read -r id name st rc dur rest <<<"$line"
  flag=""; [ "$st" = fail ] && flag="  ← 见 $OUT_DIR/$id.log"
  printf '%-4s %-22s %-6s %s%s\n' "$id" "$name" "${st^^}" "$rest$flag"
done

FAILS=0
for line in "${STEP_LINES[@]}"; do
  [[ "$line" == *"|fail|"* ]] && FAILS=$((FAILS + 1))
done
echo
if [ "$FAILS" -gt 0 ]; then
  echo "verdict: FAIL ($FAILS 步失败)"
  exit 1
fi
echo "verdict: PASS"
exit 0
