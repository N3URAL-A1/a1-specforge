#!/usr/bin/env bash
# Traces every `verify run` plan command under strace and writes one `<id with / as __>.paths` file per command plus
# `_status.tsv` (spec 027 slice 2, D5). `node _shared/a1-tools.cjs verify affected-map --traces <out>` turns that into the
# `affected` map. Usage: bash bin/affected-trace.sh --out <dir> [--jobs N] [--root <repo>]
# Linux + strace only (exit 2 otherwise). Exit 0 when every run ended, also with red ones (the generator decides).
# bash 3.2 compatible; kills only its own PIDs; removes only its own temp dirs.
# A trace ends when the suite's own process ends (a marker file written by the wrapper), not when every traced descendant
# ends: a leaked background child (e.g. a watcher) would otherwise hold `strace -f` forever. Leaked tracees are detached
# (strace gets TERM) and then killed by PID (only those whose TracerPid is our strace). --suite-timeout SECONDS (default
# 1800) caps one suite; --only <id,...> traces just those ids (a re-trace into a fresh --out dir that the caller merges); a suite that hits it gets status 124, is listed as "timeout: <ids>" and the script exits 1.
set -u

OUT=""; JOBS=6; ROOT=""; LIMIT="${A1_AFFECTED_TRACE_TIMEOUT:-1800}"; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 || exit 2 ;;
    --jobs) JOBS="${2:-}"; shift 2 || exit 2 ;;
    --root) ROOT="${2:-}"; shift 2 || exit 2 ;;
    --only) ONLY="${2:-}"; shift 2 || exit 2 ;;
    --suite-timeout) LIMIT="${2:-}"; shift 2 || exit 2 ;;
    *) echo "usage: bash bin/affected-trace.sh --out <dir> [--jobs N] [--root <repo>] [--suite-timeout SECONDS] [--only <id,...>]" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || { echo "affected-trace: --out <dir> is required" >&2; exit 2; }
case "$JOBS" in ''|*[!0-9]*|0) echo "affected-trace: --jobs must be a positive integer" >&2; exit 2 ;; esac
case "$LIMIT" in ""|*[!0-9]*|0) echo "affected-trace: --suite-timeout must be a positive integer" >&2; exit 2 ;; esac
[ "$(uname -s)" = "Linux" ] || { echo "affected-trace: needs Linux (strace)" >&2; exit 2; }
command -v strace >/dev/null 2>&1 || { echo "affected-trace: strace not found on PATH" >&2; exit 2; }
SELF="$(cd "$(dirname "$0")/.." && pwd -P)" || exit 2   # the tools live here; --root is the project that is traced
[ -n "$ROOT" ] || ROOT="$SELF"
ROOT="$(cd "$ROOT" && pwd -P)" || exit 2
mkdir -p "$OUT" && OUT="$(cd "$OUT" && pwd -P)" || exit 2
TOOLS="$SELF/_shared/a1-tools.cjs"
PARSER="$SELF/_shared/lib/verify-affected-map.cjs"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/a1-affected-trace.XXXXXX")" || exit 2
PIDS=()

cleanup() { local p; for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "${WORKDIR:?}"; }
trap 'cleanup; exit 130' INT TERM
trap 'cleanup' EXIT

IDS="$(node "$TOOLS" verify affected-map --list-ids --project "$ROOT")" || { echo "affected-trace: --list-ids failed" >&2; exit 2; }
# rows "<id>\t<argv joined by 0x1f>", longest suite first (suite-groups.json timings; unknown = 0)
printf '%s\n' "$IDS" | node -e '
  const fs = require("fs"), root = process.argv[1];
  const ids = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
  const cmds = new Map(require(process.argv[2] + "/_shared/lib/verify-run.cjs").resolveCommands(root).commands.map((c) => [c.id, c]));
  let sec = {};
  try { sec = JSON.parse(fs.readFileSync(root + "/_test-fixtures/suite-groups.json", "utf8")).timings.seconds || {}; } catch (_e) { /* no timings */ }
  const w = (id) => sec[id.replace(/^_test-fixtures\//, "")] || 0;
  const only = (process.argv[3] || "").split(",").filter(Boolean);
  if (only.length > 0) { const bad = only.filter((o) => !ids.includes(o)); if (bad.length) { console.error("affected-trace: unknown --only id " + bad[0]); process.exit(2); } ids.splice(0, ids.length, ...only); }
  ids.sort((a, b) => w(b) - w(a) || (a < b ? -1 : 1));
  for (const id of ids) process.stdout.write(id + "\t" + cmds.get(id).argv.join("\x1f") + "\n");
' "$ROOT" "$SELF" "$ONLY" > "$WORKDIR/rows" || { echo "affected-trace: cannot resolve the command argv" >&2; exit 2; }

# trace_one <id> <argv joined by 0x1f>: writes $OUT/<name>.paths and $WORKDIR/status.<name>
trace_one() {
  local id="$1" name argv home rc spid sink rcf waited=0 tp t leaked=""
  name="${id//\//__}"
  IFS=$'\037' read -r -a argv <<< "$2"
  home="$(mktemp -d "${TMPDIR:-/tmp}/a1-affected-home.XXXXXX")" || return 1
  rcf="$WORKDIR/rc.$name"; rm -f "$rcf"
  sink="$(printf '|node %q --parse-trace %q > %q' "$PARSER" "$ROOT" "$OUT/$name.paths")"
  cd "$ROOT" || return 1
  env -u A1_VAULT_ROOT -u A1_VAULT_WRITER_HOST A1_HOST_ID=leak HOME="$home" LC_ALL=C RCF_PATH="$rcf" \
    strace -f -qq -y -e trace=%file,fchdir -s 4096 -o "$sink" \
    bash -c '"$@"; r=$?; printf %s "$r" > "$RCF_PATH.tmp" && mv "$RCF_PATH.tmp" "$RCF_PATH"; exit "$r"' _ "${argv[@]}" \
    > "$OUT/$name.log" 2>&1 &
  spid=$!
  trap 'kill "$spid" 2>/dev/null' TERM INT
  # wait for the suite's own end (marker), for strace's end (no marker) or for the limit
  while [ ! -e "$rcf" ] && kill -0 "$spid" 2>/dev/null && [ "$waited" -lt "$LIMIT" ]; do sleep 1; waited=$((waited + 1)); done
  if [ -e "$rcf" ]; then rc="$(cat "$rcf")"; case "$rc" in ""|*[!0-9]*) rc=1 ;; esac
  elif kill -0 "$spid" 2>/dev/null; then rc=124
  else wait "$spid"; rc=$?; fi
  if kill -0 "$spid" 2>/dev/null; then
    for t in /proc/[0-9]*; do   # leaked tracees of our own strace only
      tp="$(sed -n 's/^TracerPid:[[:space:]]*//p' "$t/status" 2>/dev/null)"
      [ "$tp" = "$spid" ] && leaked="$leaked ${t#/proc/}"
    done
    kill -TERM "$spid" 2>/dev/null          # strace detaches every tracee and flushes the trace
    waited=0; while kill -0 "$spid" 2>/dev/null && [ "$waited" -lt 30 ]; do sleep 1; waited=$((waited + 1)); done
    kill -0 "$spid" 2>/dev/null && kill -KILL "$spid" 2>/dev/null
    for t in $leaked; do kill -KILL "$t" 2>/dev/null; done
  fi
  wait "$spid" 2>/dev/null
  rm -rf "${home:?}"
  printf '%s\t%s\n' "$id" "$rc" > "$WORKDIR/status.$name"
}

# pool: at most $JOBS runs at a time; PIDS holds only our own subshells
reap() { local keep=() p; for p in ${PIDS[@]+"${PIDS[@]}"}; do if kill -0 "$p" 2>/dev/null; then keep[${#keep[@]}]="$p"; fi; done; PIDS=(${keep[@]+"${keep[@]}"}); }
while IFS=$'\t' read -r id argv; do
  while reap; [ "${#PIDS[@]}" -ge "$JOBS" ]; do sleep 1; done
  trace_one "$id" "$argv" &
  PIDS[${#PIDS[@]}]=$!
done < "$WORKDIR/rows"
for p in ${PIDS[@]+"${PIDS[@]}"}; do wait "$p" 2>/dev/null; done
PIDS=()

# every red id once more, serially
for f in "$WORKDIR"/status.*; do
  [ -e "$f" ] || continue
  IFS=$'\t' read -r id rc < "$f"
  if [ "$rc" != "0" ] && [ "$rc" != "124" ]; then
    argv="$(ID="$id" awk -F'\t' '$1 == ENVIRON["ID"] { print $2; exit }' "$WORKDIR/rows")"
    trace_one "$id" "$argv"
  fi
done

: > "$OUT/_status.tsv"
for f in "$WORKDIR"/status.*; do [ -e "$f" ] && cat "$f" >> "$OUT/_status.tsv"; done
sort -o "$OUT/_status.tsv" "$OUT/_status.tsv"
N="$(wc -l < "$OUT/_status.tsv" | tr -d ' ')"
RED="$(awk -F'\t' '$2 != 0 { printf "%s%s", (n++ ? "," : ""), $1 }' "$OUT/_status.tsv")"
TMO="$(awk -F'\t' '$2 == 124 { printf "%s%s", (n++ ? "," : ""), $1 }' "$OUT/_status.tsv")"
echo "traced $N suites, red: ${RED:-none}"
[ -z "$TMO" ] || { echo "timeout: $TMO (limit ${LIMIT}s per suite; not mapped)" >&2; exit 1; }
exit 0
