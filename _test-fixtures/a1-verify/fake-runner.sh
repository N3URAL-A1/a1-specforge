#!/usr/bin/env bash
# Fake base runner for cases-runner-path.sh (spec 027 slice 3 wave 7). Copied into a base commit as bin/run-suites.sh.
# Answers --contract, parses the real argv, writes a D7 JSON. The mode applies only to the sides in A1_FX_RUNNER_SIDES (default head);
# every other call mirrors (all green). Modes: mirror, drop-one, extra, leak-first, red-first, symlink, exit2.
if [[ "${1:-}" == "--contract" ]]; then printf 'a1-suite-runner-%s 1\n' contract; exit 0; fi
json=""; ids=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json-out) json="$2"; shift 2 ;;
    --root|--groups-file|--suite-timeout-ms|--lock-wait|--workers) shift 2 ;;
    *) ids+=("$1"); shift ;;
  esac
done
side="$(basename "$json" .json)"; side="${side#runner-}"
mode=mirror
for s in ${A1_FX_RUNNER_SIDES:-head}; do [[ "$s" == "$side" ]] && mode="${A1_FX_RUNNER_MODE:-mirror}"; done
if [[ "$mode" == exit2 ]]; then printf '%s\n' "${A1_FX_RUNNER_ERR:-}" >&2; exit 2; fi
echo "PASS all"
node -e '
  const fs = require("fs"); const [file, mode, ...ids] = process.argv.slice(1);
  let list = ids.slice();
  if (mode === "drop-one") list = list.slice(0, -1);
  if (mode === "extra") list.push("zz/extra/run-tests.sh");
  const results = list.map((id, i) => ({ id, exit_code: mode === "red-first" && i === 0 ? 1 : 0, signal: null, timed_out: false, seconds: 0,
    leak_note: mode === "leak-first" && i === 0 ? "wrote into its sentinel vault" : "", summary_note: "" }));
  const doc = { contract: 1, root: "/x", subset: true, workers: 1, lock_wait_ms: 0, results, checks: { reconcile: "not_selected", learnings: "skipped_nogit", phases: "skipped_nogit" } };
  if (mode === "symlink") { fs.writeFileSync(file + ".real", JSON.stringify(doc)); fs.symlinkSync(file + ".real", file); } else fs.writeFileSync(file, JSON.stringify(doc));
' "$json" "$mode" "${ids[@]}"
[[ "$mode" == mirror ]] && exit 0
exit "${A1_FX_RUNNER_RC:-0}"
