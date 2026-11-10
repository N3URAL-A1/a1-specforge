# Part 08 (Security fixes SEC-1..5, Samuel review of Waves 1-3) — sourced by run-tests.sh.
# SEC-1 log base per user, owned, private; leaf created without -p · SEC-2 takeover guard judged like the lock
# · SEC-3 unpredictable stale target · SEC-4 takeover only of a real lock directory, seam absolute with an
# existing parent · SEC-5 bounded read of regular user-owned non-symlink files.
# Not provable here: the 32-byte bound itself (no observable difference) and (needs a second user): refusal of a foreign-owned base, guard or lock (-O checks).
#
# Red-making changes (one production-code change each, on a git archive snapshot):
#  S1: base without the per-user suffix / link or writable base accepted / leaf made with -p
#  S2: guard link not refused / foreign-file guard not refused
#  S3: stale target predictable (lock.stale.<pid>.<n>)
#  S4: takeover without the contents check / relative seam accepted
#  S5: pid read through a symlink (plain read -r)

SC_UID="$(id -u)"
# sc_run <tree> <workdir> <tmpname> <outname> [env assignments in LK_ENV] — runs to the end; sets LK_RC.
sc_run() {
  lk_start "$1" "$2/lock" "$2/$3" "$2/$4"
  lk_finish "$LK_PID"
}

# ---- SEC-1: log base ----
mk_tree T_S1 s1
mk_workdir W_S1 s1w
plant_suite "$T_S1" p/run-tests.sh ": > \"$W_S1/probe\"; echo 'p: 1 passed, 0 failed'"
# a) a symlinked base is refused and nothing is written through it
mkdir -p "$W_S1/ta" "$W_S1/victim"
ln -s "$W_S1/victim" "$W_S1/ta/a1-suite-runs-$SC_UID"
sc_run "$T_S1" "$W_S1" ta outa.txt
assert_eq "S1a symlinked log base exits 2" "$LK_RC" "2"
assert_contains "S1b the message names the symbolic link" "$(cat "$W_S1/outa.txt")" "symbolic link"
assert_eq "S1c nothing written through the link" "$(find "$W_S1/victim" -mindepth 1 | grep -c '')" "0"
assert_file_absent "S1d no suite started" "$W_S1/probe"
assert_file_absent "S1e the lock is released after the refusal" "$W_S1/lock"
# b) group-writable and world-writable bases are refused
for SC_MODE in 770 702 777; do
  mkdir -p "$W_S1/tb$SC_MODE"
  mkdir "$W_S1/tb$SC_MODE/a1-suite-runs-$SC_UID"
  chmod "$SC_MODE" "$W_S1/tb$SC_MODE/a1-suite-runs-$SC_UID"
  sc_run "$T_S1" "$W_S1" "tb$SC_MODE" "outb$SC_MODE.txt"
  assert_eq "S1f base mode $SC_MODE exits 2" "$LK_RC" "2"
  assert_contains "S1g base mode $SC_MODE: message names writability" "$(cat "$W_S1/outb$SC_MODE.txt")" "writable"
  assert_eq "S1h base mode $SC_MODE: no leaf created" "$(find "$W_S1/tb$SC_MODE/a1-suite-runs-$SC_UID" -mindepth 1 | grep -c '')" "0"
  assert_file_absent "S1i base mode $SC_MODE: no suite started" "$W_S1/probe"
done
# c) a fresh base is created private; a user-owned private base is reused
mkdir "$W_S1/tc"
sc_run "$T_S1" "$W_S1" tc outc.txt
assert_eq "S1j fresh base: run exits 0" "$LK_RC" "0"
assert_contains "S1k log base is a per-user directory" "$(head -n 1 "$W_S1/outc.txt")" "$W_S1/tc/a1-suite-runs-$SC_UID/"
assert_eq "S1l the base was created mode 700" "$(ls -ld "$W_S1/tc/a1-suite-runs-$SC_UID" | cut -c1-10)" "drwx------"
assert_eq "S1m the run leaf is mode 700" "$(ls -ld "$W_S1/tc/a1-suite-runs-$SC_UID"/*/ | head -n 1 | cut -c1-10)" "drwx------"
rm -f "$W_S1/probe"
sc_run "$T_S1" "$W_S1" tc outc2.txt
assert_eq "S1n the private base is reused" "$LK_RC" "0"
# d) an existing leaf is refused (no -p)
mkdir -p "$W_S1/td/a1-suite-runs-$SC_UID"
chmod 700 "$W_S1/td/a1-suite-runs-$SC_UID"
rm -f "$W_S1/probe"
# the spy mkdir creates the leaf just before the runner does: an attacker winning the race
mkdir "$W_S1/mkspy"
printf '#!/bin/bash\nfor a in "$@"; do last="$a"; done\ncase "$last" in */a1-suite-runs-*/*) %s -m 700 "$last" ;; esac\nexec %s "$@"\n' \
  "$(command -v mkdir)" "$(command -v mkdir)" > "$W_S1/mkspy/mkdir"
chmod +x "$W_S1/mkspy/mkdir"
LK_ENV="PATH=$W_S1/mkspy:$PATH" sc_run "$T_S1" "$W_S1" td outd.txt
assert_eq "S1o existing run leaf exits 2" "$LK_RC" "2"
assert_contains "S1p the message names the log directory" "$(cat "$W_S1/outd.txt")" "log directory"
assert_file_absent "S1q no suite started" "$W_S1/probe"

# ---- SEC-2: takeover guard judged like the lock ----
mk_tree T_S2 s2
mk_workdir W_S2 s2w
plant_suite "$T_S2" g/run-tests.sh ": > \"$W_S2/probe\"; echo 'g: 1 passed, 0 failed'"
( exit 0 ) & SC_DEAD=$!
wait "$SC_DEAD"
lk_plant_lock "$W_S2/lock" "$SC_DEAD"
mkdir "$W_S2/gvictim"; echo keep > "$W_S2/gvictim/pid"; echo keep > "$W_S2/gvictim/other"
ln -s "$W_S2/gvictim" "$W_S2/lock.takeover"
sc_run "$T_S2" "$W_S2" t1 out1.txt
assert_eq "S2a symlinked takeover guard exits 2" "$LK_RC" "2"
assert_contains "S2b the message names the symbolic link" "$(cat "$W_S2/out1.txt")" "symbolic link"
assert_eq "S2c the link target is untouched" "$(cat "$W_S2/gvictim/pid") $(cat "$W_S2/gvictim/other")" "keep keep"
assert_file_absent "S2d no suite started" "$W_S2/probe"
rm -f "$W_S2/lock.takeover"
# a guard directory with foreign files is refused and kept
mkdir "$W_S2/lock.takeover"; echo mine > "$W_S2/lock.takeover/precious"
sc_run "$T_S2" "$W_S2" t2 out2.txt
assert_eq "S2e guard holding foreign files exits 2" "$LK_RC" "2"
assert_contains "S2e2 the message says the guard holds foreign files" "$(cat "$W_S2/out2.txt")" "foreign files"
assert_eq "S2f the foreign file survives" "$(cat "$W_S2/lock.takeover/precious" 2>/dev/null)" "mine"
assert_file_absent "S2g no suite started" "$W_S2/probe"
rm -rf "$W_S2/lock.takeover"
# a crashed runner's own guard (user-owned, dead pid) is still removed and the run proceeds
mkdir "$W_S2/lock.takeover"; echo "$SC_DEAD" > "$W_S2/lock.takeover/pid"
sc_run "$T_S2" "$W_S2" t3 out3.txt
assert_eq "S2h dead owner's guard: run completes" "$LK_RC" "0"
assert_file_absent "S2i the guard is gone" "$W_S2/lock.takeover"
assert_file_present "S2j the suite ran" "$W_S2/probe"

# ---- SEC-3: stale target is unpredictable and private ----
mk_tree T_S3 s3
mk_workdir W_S3 s3w
plant_suite "$T_S3" s/run-tests.sh "echo 's: 1 passed, 0 failed'"
mkdir "$W_S3/spy"
REAL_MV="$(command -v mv)"
printf '#!/bin/bash\nfor a in "$@"; do last="$a"; done\nif [ "$#" -eq 2 ] && [ -d "$1" ]; then echo "$last" > "%s/dest"; ls -ld "${last%%/*}" >/dev/null 2>&1; ls -ld "$(dirname "$last")" | cut -c1-10 > "%s/mode"; fi\nexec %s "$@"\n' \
  "$W_S3/spy" "$W_S3/spy" "$REAL_MV" > "$W_S3/spy/mv"
chmod +x "$W_S3/spy/mv"
lk_plant_lock "$W_S3/lock" "$SC_DEAD"
LK_ENV="PATH=$W_S3/spy:$PATH" sc_run "$T_S3" "$W_S3" t1 out1.txt
assert_eq "S3a takeover completes" "$LK_RC" "0"
SC_DEST="$(cat "$W_S3/spy/dest" 2>/dev/null)"
case "$SC_DEST" in
  "$W_S3/lock.stale."??????/old) ok "S3b the stale target is a random private directory plus a fixed leaf" ;;
  *) bad "S3b the stale target is a random private directory plus a fixed leaf" "dest: [$SC_DEST]" ;;
esac
assert_eq "S3c that directory was created mode 700" "$(cat "$W_S3/spy/mode" 2>/dev/null)" "drwx------"
assert_eq "S3d no stale directory is left" "$(find "$W_S3" -maxdepth 1 -name 'lock.stale.*' | grep -c '')" "0"

# ---- SEC-4: takeover only of a real lock directory; the seam is absolute with an existing parent ----
mk_tree T_S4 s4
mk_workdir W_S4 s4w
plant_suite "$T_S4" q/run-tests.sh ": > \"$W_S4/probe\"; echo 'q: 1 passed, 0 failed'"
mkdir "$W_S4/lock"; echo precious > "$W_S4/lock/mydata"; mkdir "$W_S4/lock/sub"; echo deep > "$W_S4/lock/sub/f"
sc_run "$T_S4" "$W_S4" t1 out1.txt
assert_eq "S4a seam at a non-lock directory exits 2" "$LK_RC" "2"
assert_contains "S4b the message says it is not a lock directory" "$(cat "$W_S4/out1.txt")" "not a lock directory"
assert_eq "S4c the directory kept its files" "$(cat "$W_S4/lock/mydata" 2>/dev/null) $(cat "$W_S4/lock/sub/f" 2>/dev/null)" "precious deep"
assert_eq "S4d the directory was not renamed" "$(find "$W_S4" -maxdepth 1 -name 'lock*' | grep -c '')" "1"
assert_file_absent "S4e no suite started" "$W_S4/probe"
# a relative seam is refused
( cd "$W_S4" && env -u A1_SUITE_RUN_MARKER A1_SUITE_LOCK_DIR="rel-lock" TMPDIR="$W_S4/t2" bash -c 'mkdir -p "$TMPDIR"; exec bash "$0" --root "$1"' "$RUNNER" "$T_S4" ) > "$W_S4/out2.txt" 2>&1 < /dev/null
SC_RC=$?
assert_eq "S4f relative seam exits 2" "$SC_RC" "2"
assert_contains "S4g the message names the absolute-path rule" "$(cat "$W_S4/out2.txt")" "absolute"
assert_file_absent "S4h nothing created at the relative path" "$W_S4/rel-lock"
assert_file_absent "S4i no suite started" "$W_S4/probe"

# ---- SEC-5: pid files are read bounded, from regular user-owned non-symlink files only ----
mk_tree T_S5 s5
mk_workdir W_S5 s5w
plant_suite "$T_S5" h/run-tests.sh "$(lk_holder_body "$W_S5/p1" 4)"
lk_start "$T_S5" "$W_S5/lockA" "$W_S5/tmpA" "$W_S5/outA.txt"
SC_HOLDER="$LK_PID"
lk_wait_file "$W_S5/p1.ran"
# a lock whose pid is a symlink to the live holder's pid file: not followed, the lock counts as stale
mkdir "$W_S5/lockB"; ln -s "$W_S5/lockA/pid" "$W_S5/lockB/pid"
plant_suite "$T_S5" h2/run-tests.sh ": > \"$W_S5/probe2\"; echo 'h2: 1 passed, 0 failed'"
mk_tree T_S5B s5b
plant_suite "$T_S5B" h2/run-tests.sh ": > \"$W_S5/probe2\"; echo 'h2: 1 passed, 0 failed'"
lk_start "$T_S5B" "$W_S5/lockB" "$W_S5/tmpB" "$W_S5/outB.txt"
lk_finish "$LK_PID"
assert_eq "S5a pid symlink is not followed (run completes)" "$LK_RC" "0"
assert_file_present "S5b the suite ran" "$W_S5/probe2"
lk_finish "$SC_HOLDER"
assert_eq "S5c the real holder was unaffected" "$LK_RC" "0"
# a FIFO in place of the pid file does not block the runner
mkdir "$W_S5/lockC"; mkfifo "$W_S5/lockC/pid"
rm -f "$W_S5/probe2"
lk_start "$T_S5B" "$W_S5/lockC" "$W_S5/tmpC" "$W_S5/outC.txt"
lk_finish "$LK_PID"
assert_eq "S5d FIFO as pid file: run completes, no hang" "$LK_RC" "0"
assert_file_present "S5e the suite ran" "$W_S5/probe2"
