# Part 02 (Wave 1) — worker pool, worker-count rules, serial group. Sourced by run-tests.sh.
# FR-002 (bounded workers, default cores-2 clamped 1..6, exit 2 on a bad value), FR-003 (serial group
# from the declaration file; membership by measurement, exclusivity proven here).
#
# Red-making changes (one production-code line each, on a git archive snapshot):
#  P1a-P1f: dropping the "- 2" in rs_default_workers, the clamp to 6, the clamp to 1, or the
#           sysctl fallback.
#  P2a-P2c: accepting 0 / a non-number / a negative env value (or validating after the pool started).
#  P3a/P3b: the pool bound (`RS_RUNNING < width`) widened or removed: max overlap exceeds 2 (P3a);
#           the pool run strictly sequentially: max overlap 1 (P3b).
#  P4a-P4c: treating `serial` entries as ordinary pool members (the serial probe overlaps others).
#  P4d:     forcing every suite of the serial suite's directory into the serial group
#           (`X/run-other.sh` then never overlaps its pool peers).

# ---- P1: rs_default_workers (pure seam, literal inputs) ----
dw() { ( . "$REPO_ROOT/bin/run-suites-proc.sh" 2>/dev/null && rs_default_workers "$1" "$2" ) 2>&1; }
assert_eq "P1a 2 cores -> 1 worker"                 "$(dw 2 '')"   "1"
assert_eq "P1b 4 cores -> 2 workers"                "$(dw 4 '')"   "2"
assert_eq "P1c 64 cores -> 6 workers (upper clamp)" "$(dw 64 '')"  "6"
assert_eq "P1d both reads failed -> fallback 2 cores -> 1" "$(dw '' '')" "1"
assert_eq "P1e getconf unreadable, sysctl 10 -> 6"  "$(dw '' 10)"  "6"
assert_eq "P1f getconf wins over sysctl (4 vs 64) -> 2" "$(dw 4 64)" "2"
assert_eq "P1g 1 core -> 1 worker (lower clamp)"    "$(dw 1 '')"   "1"
assert_eq "P1h garbage reads -> fallback 1"         "$(dw x y)"    "1"

# ---- P2: bad worker values exit 2 before any suite starts ----
mk_tree T_BAD bad
PROBE_BAD="$T_BAD/probe-started"
plant_suite "$T_BAD" p/run-tests.sh ": > \"$PROBE_BAD\"; echo 'p: 1 passed, 0 failed'"
rs_run "$T_BAD" --workers 0
assert_eq "P2a --workers 0 exits 2" "$RS_RC" "2"
assert_file_absent "P2a no suite started" "$PROBE_BAD"
rs_run "$T_BAD" --workers x
assert_eq "P2b --workers x exits 2" "$RS_RC" "2"
assert_file_absent "P2b no suite started" "$PROBE_BAD"
RS_ENV_EXTRA="A1_SUITE_WORKERS=-1" rs_run "$T_BAD"
assert_eq "P2c A1_SUITE_WORKERS=-1 exits 2" "$RS_RC" "2"
assert_file_absent "P2c no suite started" "$PROBE_BAD"
assert_contains "P2c message names the workers setting" "$RS_OUT" "workers"

# ---- probe suites: record start/end timestamps (ms) into a shared file ----
PROBE_TPL='n="__ID__"
t() { node -e "process.stdout.write(String(Date.now()))"; }
echo "start $n $(t)" >> "__LOG__"
sleep __SECS__
echo "end $n $(t)" >> "__LOG__"
echo "$n: 1 passed, 0 failed"'
plant_probe() { # tree identity timelog seconds
  local body="${PROBE_TPL//__ID__/$2}"
  body="${body//__LOG__/$3}"
  body="${body//__SECS__/$4}"
  plant_suite "$1" "$2" "$body"
}
# max concurrency in a probe log (ends sort before starts at the same ms)
max_conc() {
  node -e '
const L = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(l => l.split(" "));
const ev = L.map(([k, n, t]) => ({ t: +t, d: k === "start" ? 1 : -1 }));
ev.sort((a, b) => a.t - b.t || a.d - b.d);
let c = 0, m = 0;
for (const e of ev) { c += e.d; if (c > m) m = c; }
process.stdout.write(String(m));' "$1"
}
# overlaps_of <log> <identity> — number of OTHER suites whose interval overlaps <identity>'s
overlaps_of() {
  node -e '
const L = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(l => l.split(" "));
const iv = {};
for (const [k, n, t] of L) { iv[n] = iv[n] || {}; iv[n][k] = +t; }
const me = iv[process.argv[2]];
let c = 0;
for (const n of Object.keys(iv)) {
  if (n === process.argv[2]) continue;
  if (iv[n].start < me.end && me.start < iv[n].end) c++;
}
process.stdout.write(String(c));' "$1" "$2"
}

# ---- P3: --workers 2 on four probe suites never shows more than 2 overlapping intervals ----
mk_tree T_POOL pool
LOG_POOL="$T_POOL/times.log"
for n in 1 2 3 4; do plant_probe "$T_POOL" "pool/run-p$n.sh" "$LOG_POOL" 1; done
rs_run "$T_POOL" --workers 2
assert_eq "P3z four probe suites ran and passed" "$RS_RC" "0"
assert_eq "P3y four start and four end records" "$(grep -c '' "$LOG_POOL")" "8"
POOL_MAX="$(max_conc "$LOG_POOL")"
if [[ "$POOL_MAX" =~ ^[0-9]+$ && "$POOL_MAX" -le 2 ]]; then ok "P3a --workers 2: max overlap $POOL_MAX <= 2"; else bad "P3a --workers 2: max overlap $POOL_MAX > 2"; fi
if [[ "$POOL_MAX" =~ ^[0-9]+$ && "$POOL_MAX" -ge 2 ]]; then ok "P3b --workers 2: the pool really runs in parallel (max overlap $POOL_MAX)"; else bad "P3b --workers 2: max overlap $POOL_MAX (no parallelism)"; fi

# ---- P4: a suite under `serial` never overlaps; a sibling runner stays in the pool ----
mk_tree T_SER ser
write_groups "$T_SER" '["x/run-tests.sh"]'
LOG_SER="$T_SER/times.log"
plant_probe "$T_SER" x/run-tests.sh "$LOG_SER" 1
plant_probe "$T_SER" x/run-other.sh "$LOG_SER" 1
plant_probe "$T_SER" y/run-a.sh "$LOG_SER" 1
plant_probe "$T_SER" y/run-b.sh "$LOG_SER" 1
rs_run "$T_SER" --workers 3
assert_eq "P4z four suites ran and passed" "$RS_RC" "0"
assert_eq "P4y four start and four end records" "$(grep -c '' "$LOG_SER")" "8"
assert_eq "P4a serial suite x/run-tests.sh overlaps no other suite" "$(overlaps_of "$LOG_SER" x/run-tests.sh)" "0"
OTHER_OVL="$(overlaps_of "$LOG_SER" x/run-other.sh)"
if [[ "$OTHER_OVL" =~ ^[0-9]+$ && "$OTHER_OVL" -ge 1 ]]; then ok "P4d x/run-other.sh stays in the pool (overlaps $OTHER_OVL peer(s))"
else bad "P4d x/run-other.sh stays in the pool" "overlaps: $OTHER_OVL"; fi
