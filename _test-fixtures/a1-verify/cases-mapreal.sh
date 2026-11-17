# Sourced by run-tests.sh (spec 027 slice 2, FR-006). Not named run*.sh on purpose.
# The committed `affected` map against the real tree. MR2 uses the pure selectAffected (planAffected needs a HEAD and would
# return no_diff_base = full in a snapshot, passing vacuously).
MRCFG="$REPO_ROOT/.a1/verify.json"
OUT="$(node "$TOOLS" verify affected-map --check --project "$REPO_ROOT" 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"
check_rc "MR1 verify affected-map --check on the real tree: exit 0" 0
MRIDS="$(node "$TOOLS" verify affected-map --list-ids --project "$REPO_ROOT" 2>/dev/null)"
mrsel() { # <changed path> -> JSON {selection, reason, ids}
  A1MR_IDS="$MRIDS" node -e '
    const { selectAffected } = require(process.argv[1] + "/_shared/lib/verify-affected.cjs");
    const cfg = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
    const r = selectAffected({ changed: [process.argv[3]], exists: () => true, cfg, planIds: process.env.A1MR_IDS.split("\n").filter(Boolean), requirers: new Map() });
    process.stdout.write(JSON.stringify({ selection: r.selection, reason: r.reason, ids: r.ids, smoke_ok: (cfg.smoke || []).every((s) => r.ids.some((i) => i.startsWith(s))) }));
  ' "$REPO_ROOT" "$MRCFG" "$1"
}
OUT="$(mrsel _shared/lib/verify-run.cjs 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"
check "MR2 a verify-run.cjs change selects a subset with the a1-verify runner and every smoke runner" 0 'j.selection+"/"+j.ids.includes("_test-fixtures/a1-verify/run-tests.sh")+"/"+j.smoke_ok' "subset/true/true"
OUT="$(mrsel bin/run-suites.sh 2>"$WORK/err")"; RC=$?; ERR="$(cat "$WORK/err")"
check "MR2b a bin/run-suites.sh change selects the full set (runner_or_config_changed)" 0 'j.selection+"/"+j.reason' "full/runner_or_config_changed"
