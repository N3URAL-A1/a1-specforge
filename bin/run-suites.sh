#!/usr/bin/env bash
# bin/run-suites.sh — parallel runner for the fixture suites (spec 026-fast-fixture-suites).
#
#   bash bin/run-suites.sh [--workers N] [--root <repo root>]
#
# Runs every discovered suite exactly once (glob _test-fixtures/*/run*.sh plus
# _test-fixtures/a1-schema-check/parser/run-parser.sh) in a bounded, longest-first worker pool, each
# under an isolated environment (own empty sentinel A1_VAULT_ROOT, own fresh HOME, A1_HOST_ID=leak,
# A1_VAULT_WRITER_HOST unset). Suites under "serial" in _test-fixtures/suite-groups.json run one at a
# time after the pool has drained. Exit 0 = all green, 1 = a suite (or the leak/reconcile check) failed,
# 2 = usage or configuration error (nothing was started).
#
# Env: A1_SUITE_WORKERS (default: online cores - 2, clamped 1..6; --workers wins).
# Files: this entry + bin/run-suites-proc.sh (workers, lock) + bin/run-suites-report.sh (logs, table).
# Portability: Bash 3.2 and GNU (indexed arrays only, no `wait -n`, no mapfile, no `timeout`).
set -u

RS_SELF="${BASH_SOURCE[0]}"
RS_BIN_DIR="$(cd "$(dirname "$RS_SELF")" && pwd)" || { echo "run-suites: cannot resolve its own directory" >&2; exit 2; }
# shellcheck disable=SC1091
. "$RS_BIN_DIR/run-suites-proc.sh" || exit 2
# shellcheck disable=SC1091
. "$RS_BIN_DIR/run-suites-report.sh" || exit 2

RS_PARSER_RUNNER="a1-schema-check/parser/run-parser.sh"
RS_RECON_ID="a1-reconcile/run-tests.sh"
RS_RECON_PATH="_test-fixtures/a1-reconcile"
RS_UNKNOWN_TIMING=9999999999
RS_MAX_LEAK_PATHS=3

RS_ROOT=""
RS_TMP=""
RS_LOGDIR=""
RS_FAILED=0
RS_SEQ=0
RS_SERIAL_LIST=""
RS_TIMING_LINES=""
RS_RECON_MODE="none"
RS_DISCOVERED=()
RS_N_DISCOVERED=0

rs_die() { echo "run-suites: $*" >&2; exit 2; }

rs_cleanup() {
  rs_lock_release
  if [ -n "${RS_TMP:-}" ] && [ -d "$RS_TMP" ]; then
    case "$RS_TMP" in
      */a1-suite-??????)
        find "$RS_TMP" -type d -exec chmod u+rwx {} + 2>/dev/null || true
        rm -rf "$RS_TMP" || true
        ;;
    esac
  fi
  return 0
}

# ---- declaration file (FR-025) ----
# Prints S<TAB>id (serial), N<TAB>id (no_count), T<TAB>id<TAB>seconds (timings); exit 2 on any problem.
rs_read_groups() {
  node -e '
const fs = require("fs");
const f = process.argv[1];
const fail = (m) => { console.error("run-suites: " + f + ": " + m); process.exit(2); };
let j;
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail("cannot read or parse (" + e.message + ")"); }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
if (!isObj(j)) fail("top level must be an object");
if (!isList(j.serial)) fail("\"serial\" must be a list of suite identities");
if (!isList(j.no_count)) fail("\"no_count\" must be a list of suite identities");
if (!isObj(j.ci_jobs)) fail("\"ci_jobs\" must be an object");
if (!isObj(j.timings)) fail("\"timings\" must be an object");
const sec = j.timings.seconds === undefined ? {} : j.timings.seconds;
if (!isObj(sec)) fail("\"timings.seconds\" must be an object");
const out = [];
for (const id of j.serial) out.push("S\t" + id);
for (const id of j.no_count) out.push("N\t" + id);
for (const id of Object.keys(sec)) {
  if (typeof sec[id] !== "number" || !(sec[id] >= 0)) fail("timing of " + id + " must be a number >= 0");
  out.push("T\t" + id + "\t" + Math.round(sec[id]));
}
process.stdout.write(out.join("\n") + (out.length ? "\n" : ""));
' "$1"
}

rs_load_groups() {
  local f="$RS_ROOT/_test-fixtures/suite-groups.json" out rc kind a b
  [ -f "$f" ] || rs_die "$f: declaration file (suite-groups.json) missing"
  out="$(rs_read_groups "$f" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then echo "$out" >&2; exit 2; fi
  while IFS=$'\t' read -r kind a b; do
    case "$kind" in
      S) RS_SERIAL_LIST="$RS_SERIAL_LIST$a"$'\n' ;;
      T) RS_TIMING_LINES="$RS_TIMING_LINES$a"$'\t'"$b"$'\n' ;;
    esac
  done <<< "$out"
  RS_SERIAL_LIST=$'\n'"$RS_SERIAL_LIST"
}

# rs_is_serial <id> — 0 when listed under "serial".
rs_is_serial() { [[ "$RS_SERIAL_LIST" == *$'\n'"$1"$'\n'* ]]; }

# ---- discovery (FR-001, FR-014) ----
rs_discover() {
  local r id list="" sorted
  for r in "$RS_ROOT"/_test-fixtures/*/run*.sh "$RS_ROOT/_test-fixtures/$RS_PARSER_RUNNER"; do
    [ -f "$r" ] || continue
    id="${r#"$RS_ROOT"/_test-fixtures/}"
    list="$list$id"$'\n'
  done
  sorted="$(printf '%s' "$list" | LC_ALL=C sort -u)"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    RS_DISCOVERED[$RS_N_DISCOVERED]="$id"
    RS_N_DISCOVERED=$((RS_N_DISCOVERED + 1))
  done <<< "$sorted"
}

# rs_timing_of <id> — reference seconds, or the "unknown" key (unknown suites start first).
rs_timing_of() {
  local id="$1" k t
  while IFS=$'\t' read -r k t; do
    if [ "$k" = "$id" ]; then printf '%s\n' "$t"; return 0; fi
  done <<< "$RS_TIMING_LINES"
  printf '%s\n' "$RS_UNKNOWN_TIMING"
}

# rs_order <file> — writes <file>.sorted: key, identity, S|P; longest first (unknown first, then name).
rs_order() {
  local i=0 id t key kind
  : > "$1"
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
    id="${RS_DISCOVERED[$i]}"
    t="$(rs_timing_of "$id")"
    key="$(printf '%010d' "$t")"
    kind=P
    if rs_is_serial "$id"; then kind=S; fi
    printf '%s\t%s\t%s\n' "$key" "$id" "$kind" >> "$1"
    i=$((i + 1))
  done
  LC_ALL=C sort -t"$(printf '\t')" -k1,1r -k2,2 "$1" > "$1.sorted"
}

# ---- one finished suite: result, leak check, isolation dirs removed ----
rs_on_suite_done() {
  local slot="$1" rc="$2" id log dir vault elapsed note="" leaked st p
  id="${RS_SLOT_ID[$slot]}"; log="${RS_SLOT_LOG[$slot]}"; dir="${RS_SLOT_DIR[$slot]}"
  vault="$dir/vault"
  elapsed=$((SECONDS - ${RS_SLOT_START[$slot]}))
  if [ "$rc" -gt 128 ]; then note="killed by signal $((rc - 128))"; fi
  if [ -d "$vault" ] && [ -n "$(ls -A "$vault" 2>/dev/null)" ]; then
    note="${note:+$note; }wrote into its sentinel vault"
    echo "suite $id left files in its sentinel vault (first $RS_MAX_LEAK_PATHS):"
    leaked="$(find "$vault" -mindepth 1 2>/dev/null | LC_ALL=C sort | head -n "$RS_MAX_LEAK_PATHS")"
    while IFS= read -r p; do
      if [ -n "$p" ]; then echo "  leaked: $p"; fi
    done <<< "$leaked"
  fi
  st=PASS
  if [ "$rc" -ne 0 ] || [ -n "$note" ]; then st=FAIL; fi
  echo "done: $st $id (${elapsed}s)"
  rs_record_result "$id" "$rc" "$elapsed" "$log" "$note"
  rs_remove_slot_dir "$dir"
  RS_SLOT_ID[$slot]=""; RS_SLOT_DIR[$slot]=""
}

rs_remove_slot_dir() {
  local d="$1"
  case "$d" in
    "$RS_TMP"/w[0-9]*)
      if [ -d "$d" ]; then
        find "$d" -type d -exec chmod u+rwx {} + 2>/dev/null || true
        rm -rf "$d" || true
      fi
      ;;
  esac
}

# rs_start_suite <id> — a free slot is required. Failing to build the isolation dirs fails that suite only.
rs_start_suite() {
  local id="$1" slot d log
  slot="$(rs_free_slot)" || return 1
  RS_SEQ=$((RS_SEQ + 1))
  d="$RS_TMP/w$RS_SEQ"
  log="$RS_LOGDIR/${id//\//__}.log"
  if ! mkdir -p "$d/home" "$d/vault"; then
    echo "run-suites: cannot create isolation directories for $id" > "$log" 2>&1 || true
    echo "done: FAIL $id (0s)"
    rs_record_result "$id" 2 0 "$log" "cannot create isolation directories"
    return 0
  fi
  rs_spawn_worker "$id" "$log" "$d/home" "$d/vault"
  RS_SLOT_PID[$slot]="$RS_LAST_PGID"
  RS_SLOT_ID[$slot]="$id"
  RS_SLOT_START[$slot]="$SECONDS"
  RS_SLOT_LOG[$slot]="$log"
  RS_SLOT_DIR[$slot]="$d"
  RS_RUNNING=$((RS_RUNNING + 1))
}

# rs_run_batch <width> <id>... — at most <width> suites at once; returns when all have ended.
rs_run_batch() {
  local width="$1" total next=0
  shift
  total=$#
  if [ "$total" -eq 0 ]; then return 0; fi
  local ids=("$@")
  rs_slots_reset "$width"
  while [ "$next" -lt "$total" ] || [ "$RS_RUNNING" -gt 0 ]; do
    while [ "$next" -lt "$total" ] && [ "$RS_RUNNING" -lt "$width" ]; do
      rs_start_suite "${ids[$next]}"
      next=$((next + 1))
    done
    rs_wait_any
  done
}

# ---- a1-reconcile restore/clean check (FR-021): once, after all workers ----
rs_root_is_git_toplevel() {
  local top phys
  top="$(git -C "$RS_ROOT" rev-parse --show-toplevel 2>/dev/null)" || return 1
  phys="$(cd "$RS_ROOT" && pwd -P)" || return 1
  [ "$top" = "$phys" ]
}
rs_recon_porcelain() { git -C "$RS_ROOT" status --porcelain -- "$RS_RECON_PATH" 2>/dev/null; }

rs_reconcile_pre() {
  local i=0 sel=0
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do
    if [ "${RS_DISCOVERED[$i]}" = "$RS_RECON_ID" ]; then sel=1; fi
    i=$((i + 1))
  done
  if [ "$sel" -ne 1 ]; then return 0; fi
  if ! rs_root_is_git_toplevel; then RS_RECON_MODE=nogit
  elif [ -z "$(rs_recon_porcelain)" ]; then RS_RECON_MODE=clean
  else RS_RECON_MODE=dirty; fi
}

rs_reconcile_post() {
  local left
  case "$RS_RECON_MODE" in
    nogit) echo "reconcile check skipped: no git work tree at $RS_ROOT" ;;
    dirty) echo "reconcile check skipped: $RS_RECON_PATH had local edits before the run; left untouched" ;;
    clean)
      if [ -n "$(rs_recon_porcelain)" ]; then
        if git -C "$RS_ROOT" checkout HEAD -- "$RS_RECON_PATH" >/dev/null 2>&1; then
          echo "reconcile check: restored $RS_RECON_PATH to its committed state"
        fi
      fi
      left="$(rs_recon_porcelain)"
      if [ -n "$left" ]; then
        echo "reconcile check FAILED: $RS_RECON_PATH is still modified:"
        printf '%s\n' "$left" | sed 's/^/  /'
        RS_FAILED=1
      else
        echo "reconcile check: $RS_RECON_PATH is clean"
      fi
      ;;
  esac
}

# ---- main ----
rs_main() {
  local workers="" order i key id kind
  local pool=() serial=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --workers) [ $# -ge 2 ] || rs_die "--workers needs a value"; workers="$2"; shift 2 ;;
      --workers=*) workers="${1#--workers=}"; shift ;;
      --root) [ $# -ge 2 ] || rs_die "--root needs a directory"; RS_ROOT="$2"; shift 2 ;;
      -h|--help) sed -n '2,15p' "$RS_SELF"; exit 0 ;;
      *) rs_die "unknown argument: $1" ;;
    esac
  done
  if [ -z "$workers" ]; then workers="${A1_SUITE_WORKERS:-}"; fi
  if [ -z "$workers" ]; then
    workers="$(rs_default_workers "$(getconf _NPROCESSORS_ONLN 2>/dev/null)" "$(sysctl -n hw.ncpu 2>/dev/null)")"
  elif ! rs_is_posint "$workers"; then
    rs_die "workers must be an integer from 1 to 9999 (got '$workers')"
  fi
  [ -n "$RS_ROOT" ] || RS_ROOT="$(cd "$RS_BIN_DIR/.." && pwd)"
  [ -d "$RS_ROOT/_test-fixtures" ] || rs_die "no _test-fixtures directory under $RS_ROOT"
  RS_ROOT="$(cd "$RS_ROOT" && pwd -P)" || rs_die "cannot resolve $RS_ROOT"

  rs_load_groups
  rs_discover
  [ "$RS_N_DISCOVERED" -gt 0 ] || rs_die "no suites discovered under $RS_ROOT/_test-fixtures"

  rs_lock_acquire || exit 2
  trap rs_cleanup EXIT
  trap 'rs_on_signal INT' INT
  trap 'rs_on_signal TERM' TERM

  RS_TMP="$(mktemp -d "${TMPDIR:-/tmp}/a1-suite-XXXXXX")" || rs_die "cannot create a work directory under ${TMPDIR:-/tmp}"
  [ -n "$RS_TMP" ] && [ -d "$RS_TMP" ] || rs_die "work directory missing"
  RS_LOGDIR="${TMPDIR:-/tmp}/a1-suite-runs/$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$RS_LOGDIR" || rs_die "cannot create the log directory $RS_LOGDIR"
  rs_export_marker

  echo "log dir: $RS_LOGDIR"
  echo "full run"
  echo "workers: $workers"
  echo "discovered $RS_N_DISCOVERED suites"
  i=0
  while [ "$i" -lt "$RS_N_DISCOVERED" ]; do echo "${RS_DISCOVERED[$i]}"; i=$((i + 1)); done

  order="$RS_TMP/order"
  rs_order "$order"
  while IFS=$'\t' read -r key id kind; do
    if [ "$kind" = S ]; then serial[${#serial[@]}]="$id"; else pool[${#pool[@]}]="$id"; fi
  done < "$order.sorted"

  rs_reconcile_pre
  RS_T0="$SECONDS"
  if [ "${#pool[@]}" -gt 0 ]; then rs_run_batch "$workers" "${pool[@]}"; fi
  if [ "${#serial[@]}" -gt 0 ]; then rs_run_batch 1 "${serial[@]}"; fi
  rs_reconcile_post

  rs_print_table
  rs_print_failures
  echo "total wall-clock: $((SECONDS - RS_T0))s"
  i=0
  while [ "$i" -lt "$RS_N_RES" ]; do
    if [ "${RS_RES_RC[$i]}" -ne 0 ] || [ -n "${RS_RES_NOTE[$i]}" ]; then RS_FAILED=1; fi
    i=$((i + 1))
  done
  [ "$RS_FAILED" -eq 0 ]
}

rs_main "$@"
exit $?
