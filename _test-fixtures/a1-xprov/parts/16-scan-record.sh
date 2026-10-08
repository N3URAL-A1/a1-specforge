#!/usr/bin/env bash
# Part 16 — spec 014 Wave 2: the scan-pass record and the index entries at
# snapshot time (FR-005, FR-007). Sourced by run-tests.sh.
#
# Expectations are literals from the spec (record keys, modes, hash recipes);
# every hash is recomputed here with plain git/shasum, never with the module
# under test. Each arm runs under its OWN fresh HOME so the records of other
# parts never leak in. Arm -> the single production change that turns it red:
#
#   SR1  passing plan-mode snapshot -> ~/.a1-xprov/scan-records/<basename>.json,
#        exactly the 13 spec keys, file 0600, dir 0700, values equal to what git
#        says, nonce 32 hex == <snapshot>.inputs/scan.nonce.   Red if no record.
#   SR1b inspect mode (--base) -> base and diff_sha256 are set.  Red if the
#        record drops the base side.
#   SR1c status_sha256 == sha256 of `git status --porcelain=v1 -z
#        --untracked-files=all --ignored` taken after the strip; a tracked
#        AGENTS.md (stripped) is part of it.   Red if taken before the strip.
#   SR2  planted secret -> exit 1 secret_in_snapshot and NO record for it.
#        Red if the record is written before the scan verdict.
#   SR3  `snapshot --remove` removes the record.  Red if removeSnapshotDirs
#        leaves it.
#   SR4  gc removes records older than 14 days and orphan records, keeps young
#        ones with a live snapshot, never touches foreign files.  Red if gc
#        ignores scan-records/.
#   SR5  scanTrackedFiles: N tracked -> N {mode, blob, path} entries and
#        index_sha256 == sha256 of `git ls-files -s -z`; `tracked` stays a
#        string array.   Red if still `ls-files -z`.
#   SR6  a record write failure (scan-records is a symlink) fails the snapshot
#        (snapshot_failed), the snapshot dirs are gone, nothing is written
#        through the link.   Red if the failure is swallowed or followed.
#   SR7  unit arms of the record module: parse rejections, the reader refuses
#        a 0644 file, a symlinked file and a 0755 dir; write leaves no temp file.

TMP16="$(mktemp -d)"
make_tree

SR_RECORD_KEYS='["version","snapshot","repo_key","commit","base","tree","index_sha256","status_sha256","diff_sha256","inputs","gitleaks","nonce","ts"]'
SR_Q="QQQQQQQQQQQQQQQQ"; SR_AKI="AKI"
SR_FAKE_KEY="${SR_AKI}A${SR_Q}"          # aws_access_key_id shape, assembled at run time

sha256_stdin() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'; else sha256sum | awk '{print $1}'; fi; }

# sr_repo <name> — fresh phase repo whose tree also tracks AGENTS.md and a file
# with a space in its name (the snapshot strips AGENTS.md). Sets PHASE_*.
sr_repo() {
  make_phase "$1"
  printf 'repo-local agent notes\n' > "$PHASE_REPO/AGENTS.md"
  printf 'x\n' > "$PHASE_REPO/src/with space.txt"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: agents + spaced name" )
  PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"
}

# sr_snap <home> [extra snapshot flags...] — snapshot of $PHASE_REPO under HOME=<home>. Sets SR_OUT, SR_ERR, SR_RC, SR_DIR.
sr_snap() {
  local home="$1"; shift
  SR_OUT="$(cd "$PHASE_REPO" && HOME="$home" node "$TREE_TOOLS" xprov snapshot --repo "$PHASE_REPO" --commit HEAD --plan "$PHASE_PLAN" "$@" 2>"$TMP16/err.txt")"; SR_RC=$?
  SR_ERR="$(cat "$TMP16/err.txt")"
  SR_DIR="$(json_get "$SR_OUT" "j.snapshot || ''")"; [[ "$SR_DIR" == "UNPARSEABLE" ]] && SR_DIR=""
}

sr_home() { local h; h="$(mktemp -d "$TMP16/home.XXXXXX")"; mkdir -p "$h/.codex"; printf '%s' "$h"; }

sr_record_file() { printf '%s/.a1-xprov/scan-records/%s.json' "$1" "$(basename "$2")"; }

# ---------- SR1 / SR1c: plan mode ----------
{
  sr_repo sr1; home="$(sr_home)"
  sr_snap "$home"
  assert_rc "SR1 plan-mode snapshot exits 0" 0 "$SR_RC" "$SR_ERR"
  rec="$(sr_record_file "$home" "$SR_DIR")"
  if [[ -n "$SR_DIR" && -f "$rec" ]]; then
    ok "SR1 the record scan-records/<basename>.json exists"
    body="$(cat "$rec")"
    assert_json "SR1 exactly the 13 spec keys, in spec order" "$body" "JSON.stringify(Object.keys(j))" "$SR_RECORD_KEYS"
    assert_eq "SR1 record file mode is 0600" "$(mode_of "$rec")" "600"
    assert_eq "SR1 scan-records dir mode is 0700" "$(mode_of "$home/.a1-xprov/scan-records")" "700"
    assert_json "SR1 version is 1" "$body" "j.version" "1"
    real_snap="$(cd "$SR_DIR" && pwd -P)"
    assert_json "SR1 snapshot is the realpath" "$body" "j.snapshot" "$real_snap"
    common="$(cd "$PHASE_REPO" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
    assert_json "SR1 repo_key is the realpath git-common-dir of the primary checkout" "$body" "j.repo_key" "$common"
    assert_json "SR1 commit is HEAD" "$body" "j.commit" "$PHASE_HEAD"
    assert_json "SR1 base is null in plan mode" "$body" "j.base === null" "true"
    assert_json "SR1 tree is HEAD^{tree}" "$body" "j.tree" "$(git -C "$SR_DIR" rev-parse 'HEAD^{tree}')"
    assert_json "SR1 index_sha256 = sha256 of git ls-files -s -z" "$body" "j.index_sha256" "$(git -C "$SR_DIR" ls-files -s -z | sha256_stdin)"
    assert_json "SR1c status_sha256 = sha256 of git status --porcelain=v1 -z --untracked-files=all --ignored" "$body" "j.status_sha256" \
      "$(git -C "$SR_DIR" status --porcelain=v1 -z --untracked-files=all --ignored | sha256_stdin)"
    st_raw="$(git -C "$SR_DIR" status --porcelain=v1 -z --untracked-files=all --ignored | tr '\0' '\n')"
    [[ "$st_raw" == *"AGENTS.md"* ]] && ok "SR1c the stripped AGENTS.md deletion is part of the status that is hashed" || bad "SR1c setup: status does not show the stripped AGENTS.md"
    assert_json "SR1 diff_sha256 is null in plan mode" "$body" "j.diff_sha256 === null" "true"
    assert_json "SR1 inputs holds the plan copy hash" "$body" "JSON.stringify(j.inputs)" "{\"plan\":\"$(sha256_stdin < "$PHASE_PLAN")\"}"
    assert_json "SR1 gitleaks is true (the fake gitleaks is on PATH)" "$body" "j.gitleaks" "true"
    assert_json "SR1 nonce is 32 lowercase hex characters" "$body" "/^[0-9a-f]{32}\$/.test(j.nonce)" "true"
    nonce_json="$(json_get "$body" "j.nonce")"
    assert_eq "SR1 <snapshot>.inputs/scan.nonce holds the same nonce" "$(tr -d '\n' < "$SR_DIR.inputs/scan.nonce" 2>/dev/null)" "$nonce_json"
    assert_json "SR1 ts parses as an ISO date" "$body" "!Number.isNaN(Date.parse(j.ts))" "true"
    assert_json "SR1 the CLI result keeps ok:true" "$SR_OUT" "j.ok" "true"
  else
    bad "SR1 no record at $rec"
  fi
}

# ---------- SR1b: inspect mode ----------
{
  sr_repo sr1b; home="$(sr_home)"
  base="$PHASE_HEAD"
  printf 'export const two = 2;\n' > "$PHASE_REPO/src/two.js"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: wave commit" ); PHASE_HEAD="$(cd "$PHASE_REPO" && git rev-parse HEAD)"
  sr_snap "$home" --base "$base"
  assert_rc "SR1b inspect-mode snapshot exits 0" 0 "$SR_RC" "$SR_ERR"
  rec="$(sr_record_file "$home" "$SR_DIR")"
  if [[ -f "$rec" ]]; then
    body="$(cat "$rec")"
    assert_json "SR1b base is the base sha" "$body" "j.base" "$base"
    assert_json "SR1b diff_sha256 equals the stored diff hash" "$body" "j.diff_sha256" "$(tr -d '\n' < "$SR_DIR.inputs/diff.sha256" 2>/dev/null || echo MISSING)"
    assert_json "SR1b diff_sha256 is a 64-hex string" "$body" "/^[0-9a-f]{64}\$/.test(j.diff_sha256)" "true"
  else
    bad "SR1b no record at $rec"
  fi
}

# ---------- SR2: planted secret -> no record ----------
{
  sr_repo sr2; home="$(sr_home)"
  printf 'k = "%s"\n' "$SR_FAKE_KEY" > "$PHASE_REPO/src/leak.js"
  ( cd "$PHASE_REPO" && git add -A && git commit -qm "fixture: planted key" )
  sr_snap "$home"
  assert_rc "SR2 planted secret exits 1" 1 "$SR_RC"
  assert_json "SR2 reason is secret_in_snapshot" "$SR_OUT" "j.reason" "secret_in_snapshot"
  n="$(find "$home/.a1-xprov/scan-records" -type f 2>/dev/null | wc -l | tr -d ' ')"
  assert_eq "SR2 scan-records holds no file" "$n" "0"
}

# ---------- SR3: --remove removes the record ----------
{
  sr_repo sr3; home="$(sr_home)"
  sr_snap "$home"; snap="$SR_DIR"; rec="$(sr_record_file "$home" "$snap")"
  [[ -f "$rec" ]] || bad "SR3 setup: no record to remove"
  ( cd "$PHASE_REPO" && HOME="$home" node "$TREE_TOOLS" xprov snapshot --remove "$snap" >/dev/null 2>&1 ); rc=$?
  assert_rc "SR3 snapshot --remove exits 0" 0 "$rc"
  [[ ! -e "$snap" && ! -e "$rec" ]] && ok "SR3 snapshot dir and record are gone" || bad "SR3 leftovers: snapshot=$([[ -e "$snap" ]] && echo yes || echo no) record=$([[ -e "$rec" ]] && echo yes || echo no)"
}

# ---------- SR4: gc ----------
{
  sr_repo sr4; home="$(sr_home)"
  sr_snap "$home"; young="$SR_DIR"
  sr_snap "$home"; old="$SR_DIR"
  r_young="$(sr_record_file "$home" "$young")"; r_old="$(sr_record_file "$home" "$old")"
  r_orphan="$home/.a1-xprov/scan-records/snap-orphan0001.json"
  cp "$r_young" "$r_orphan"; chmod 600 "$r_orphan"
  printf 'keep me\n' > "$home/.a1-xprov/scan-records/notes.txt"
  node -e "
    const fs = require('fs'); const t = Date.now() / 1000 - 15 * 86400;
    fs.utimesSync(process.argv[1], t, t);
  " "$r_old"
  out="$(cd "$PHASE_REPO" && HOME="$home" node "$TREE_TOOLS" xprov gc 2>/dev/null)"; rc=$?
  assert_rc "SR4 gc exits 0" 0 "$rc"
  [[ ! -e "$r_old" ]] && ok "SR4 a 15-day-old record is removed although its snapshot dir exists" || bad "SR4 the old record survived gc"
  [[ ! -e "$r_orphan" ]] && ok "SR4 an orphan record (no snapshot dir) is removed" || bad "SR4 the orphan record survived gc"
  [[ -f "$r_young" ]] && ok "SR4 a young record with a live snapshot is kept" || bad "SR4 gc removed the young record"
  [[ -f "$home/.a1-xprov/scan-records/notes.txt" ]] && ok "SR4 a foreign file in scan-records is untouched" || bad "SR4 gc removed a foreign file"
  assert_json "SR4 gc reports the removed record count" "$out" "j.scan_records_removed.length" "2"
  assert_json "SR4 gc reports the kept record count" "$out" "j.scan_records_kept.length" "1"
}

# ---------- SR5: index entries ----------
{
  sr_repo sr5
  want_n="$(git -C "$PHASE_REPO" ls-files -z | tr -cd '\0' | wc -c | tr -d ' ')"
  want_sha="$(git -C "$PHASE_REPO" ls-files -s -z | sha256_stdin)"
  want_first="$(git -C "$PHASE_REPO" ls-files -s -z | tr '\0' '\n' | head -n 1)"
  res="$(node -e '
    const S = require(process.argv[1] + "/_shared/lib/xprov-snapshot.cjs");
    const r = S.scanTrackedFiles(process.argv[2], { lines: true });
    process.stdout.write(JSON.stringify({ n: r.entries.length, sha: r.index_sha256, tracked: r.tracked.length, trackedStrings: r.tracked.every((t) => typeof t === "string"), keys: r.entries.map((e) => Object.keys(e).join(",")).filter((v, i, a) => a.indexOf(v) === i), first: r.entries[0] }));
  ' "$TREE" "$PHASE_REPO" 2>&1)"
  assert_json "SR5 N tracked paths -> N entries" "$res" "j.n" "$want_n"
  assert_json "SR5 index_sha256 = sha256 of git ls-files -s -z" "$res" "j.sha" "$want_sha"
  assert_json "SR5 entries carry exactly mode, blob, path" "$res" "JSON.stringify(j.keys)" '["mode,blob,path"]'
  mode="${want_first%% *}"; rest="${want_first#* }"; blob="${rest%% *}"; fpath="${want_first#*$'\t'}"
  assert_json "SR5 the first entry equals the first git line" "$res" "j.first.mode + ' ' + j.first.blob + ' ' + j.first.path" "$mode $blob $fpath"
  assert_json "SR5 tracked stays an array of N strings" "$res" "j.trackedStrings && j.tracked" "$want_n"
  assert_json "SR5 a path with a space survives -z parsing" "$(node -e '
    const S = require(process.argv[1] + "/_shared/lib/xprov-snapshot.cjs");
    process.stdout.write(JSON.stringify(S.scanTrackedFiles(process.argv[2], {}).entries.map((e) => e.path)));
  ' "$TREE" "$PHASE_REPO")" "j.includes('src/with space.txt')" "true"
}

# ---------- SR6: a record write failure fails the snapshot ----------
{
  sr_repo sr6; home="$(sr_home)"
  mkdir -p "$home/.a1-xprov" "$TMP16/elsewhere"; chmod 700 "$home/.a1-xprov"
  ln -s "$TMP16/elsewhere" "$home/.a1-xprov/scan-records"
  sr_snap "$home"
  assert_rc "SR6 a symlinked scan-records dir fails the snapshot" 1 "$SR_RC"
  assert_json "SR6 reason is snapshot_failed" "$SR_OUT" "j.reason" "snapshot_failed"
  n="$(find "$TMP16/elsewhere" -type f 2>/dev/null | wc -l | tr -d ' ')"
  assert_eq "SR6 nothing was written through the symlink" "$n" "0"
  left="$(ls "$home/.a1-xprov/snapshots" 2>/dev/null | wc -l | tr -d ' ')"
  assert_eq "SR6 the snapshot dirs were removed" "$left" "0"
}

# ---------- SR7: the record module ----------
{
  home="$(sr_home)"
  lib="$(HOME="$home" node -e '
    const fs = require("fs"); const path = require("path");
    const R = require(process.argv[1] + "/_shared/lib/xprov-scan-records.cjs");
    const good = { version: 1, snapshot: "/s", repo_key: "/r", commit: "c", base: null, tree: "t", index_sha256: "i", status_sha256: "s", diff_sha256: null, inputs: { plan: "h" }, gitleaks: true, nonce: "0123456789abcdef0123456789abcdef", ts: "2026-10-08T00:00:00Z" };
    const out = {};
    const bads = {
      extraKey: { ...good, extra: 1 }, missingKey: (({ ts, ...r }) => r)(good), badVersion: { ...good, version: 2 }, emptyString: { ...good, tree: "" },
      shortNonce: { ...good, nonce: "abc" }, upperNonce: { ...good, nonce: "0123456789ABCDEF0123456789abcdef" }, gitleaksStr: { ...good, gitleaks: "true" },
      inputsNonString: { ...good, inputs: { plan: 1 } }, baseNumber: { ...good, base: 5 },
    };
    out.rejected = Object.entries(bads).filter(([, d]) => R.parseScanRecord(d) === null).map(([k]) => k);
    out.goodParsed = R.parseScanRecord(good) !== null;
    out.nonceOk = /^[0-9a-f]{32}$/.test(R.newNonce()) && R.newNonce() !== R.newNonce();
    try { R.writeScanRecord("../evil", good); out.traversal = "written"; } catch (e) { out.traversal = "refused"; }
    try { R.writeScanRecord("snap-x1", { ...good, extra: 1 }); out.badDoc = "written"; } catch (e) { out.badDoc = "refused"; }
    R.writeScanRecord("snap-x1", good);
    out.roundTrip = JSON.stringify(R.readScanRecord("snap-x1").value) === JSON.stringify(good);
    out.noTmp = fs.readdirSync(R.scanRecordsDir()).filter((n) => n.endsWith(".tmp")).length;
    const f = path.join(R.scanRecordsDir(), "snap-x1.json");
    fs.chmodSync(f, 0o644); out.mode644 = R.readScanRecord("snap-x1").ok;
    fs.chmodSync(f, 0o600); fs.renameSync(f, f + ".real"); fs.symlinkSync(f + ".real", f); out.symlinkFile = R.readScanRecord("snap-x1").ok;
    fs.unlinkSync(f); fs.renameSync(f + ".real", f);
    fs.chmodSync(R.scanRecordsDir(), 0o755); out.dir755 = R.readScanRecord("snap-x1").ok; fs.chmodSync(R.scanRecordsDir(), 0o700);
    out.missing = R.readScanRecord("snap-nothere").missing === true;
    fs.writeFileSync(f, "{\"version\":1,\"version\":1}", { mode: 0o600 }); out.dupKey = R.readScanRecord("snap-x1").ok;
    process.stdout.write(JSON.stringify(out));
  ' "$TREE" 2>&1)"
  assert_json "SR7 nine malformed documents are rejected" "$lib" "j.rejected.length" "9"
  assert_json "SR7 a good document parses" "$lib" "j.goodParsed" "true"
  assert_json "SR7 newNonce is 32 hex and fresh" "$lib" "j.nonceOk" "true"
  assert_json "SR7 a traversal name is refused" "$lib" "j.traversal" "refused"
  assert_json "SR7 an off-format document is refused by the writer" "$lib" "j.badDoc" "refused"
  assert_json "SR7 write then read round-trips" "$lib" "j.roundTrip" "true"
  assert_json "SR7 no temp file is left behind" "$lib" "j.noTmp" "0"
  assert_json "SR7 the reader refuses a 0644 file" "$lib" "j.mode644" "false"
  assert_json "SR7 the reader refuses a symlinked file" "$lib" "j.symlinkFile" "false"
  assert_json "SR7 the reader refuses a 0755 directory" "$lib" "j.dir755" "false"
  assert_json "SR7 a missing record reads as missing" "$lib" "j.missing" "true"
  assert_json "SR7 a duplicate-key document is refused" "$lib" "j.dupKey" "false"
}

rm -rf "$TMP16"
