# STATUS-cuts (lane cuts, Waves 7-9)

## Wave 7 — a1-new-feature SKILL.md: kritis, Marketing, Isolation
| Task | Status | Commit | Notes |
|---|---|---|---|
| 7.1 | DONE | 25844be | kritis.md, SKILL.md cuts (461 -> 368), allowed-diff rows, P-allowed literal simulation, D multiset compare, WIRE_SIX :0, R mutation re-pin, K5-K7 |

Pins changed (listed): kritis B (WIRE_SIX :0), D (multiset), P (allowed-diff rows), P-allowed (literal simulation).
Unlisted pin, red at first run: kritis R mutation (08-wiring.sh, caseWireResolveReachable): the mutation moved the resolve line into the first kritis block, which no longer exists in SKILL.md; it now wraps the line in a synthetic block. Old R mutation on the new tree: `R resolve step (mutation): expected 1 0 1, got [1 1 1]` (red, shown in RED-proof 7.1 e). New pin red run: see 7.1 g.
Anchors: each allowed-diff anchor checked with grep -cxF on the golden SKILL.md (1 each: "in the phase flow.", the Isolation heading, the hard-rule line); apply-prompts-allowed.cjs accepts them (P, P-allowed green). Kritis golden dir diff vs c6b10a2: empty (golden/prompts untouched).

RED-proof 7.1 a one extra SKILL.md line -> P, D red (rc=1)
RED-proof 7.1 b one byte in kritis.md line 20 -> K5 red (rc=1)
RED-proof 7.1 c `## Marketing Gate` heading back -> K6 red (plus P, D) (rc=1)
RED-proof 7.1 d fourth Isolation line -> K7 red (plus P, D) (rc=1)
RED-proof 7.1 e old 08-wiring.sh (old B, D, R pins) on the new tree -> B, D, R-mutation red (rc=1)
RED-proof 7.1 f golden anchor "in the phase flow." occurring twice -> apply-prompts-allowed.cjs exit 3: `golden line occurs 2 times (need 1)` -> P, P-allowed red (rc=1)
RED-proof 7.1 g the R mutation pin with the old mutation on the new tree is the e run (R mutation red); the new mutation turns R red when the wrapped line is placed inside a block and green otherwise (R mutation case passes on the real tree: the wrapped copy gives `1 0 1`)

Suites after Wave 7 (all green): a1-kritis-profile 228, a1-ux-studio 407, a1-intent 1128, a1-pr-review 97, a1-workflow-lint 76, a1-quick 57, a1-fix 93, a1-worktree 166, a1-probe 894, a1-retro-validate 67, a1-metrics 476, a1-dashboard 423, run-wave13 10, run-wave14 50, check-wave11-callsites calls=15.

## Wave 8 — 06-verify: retro-prose.md and compressions
| Task | Status | Commit | Notes |
|---|---|---|---|
| 8.1 | DONE | 70f3c59 | retro-prose.md (63 lines), 06-verify.md 522 -> 410, Step 6 stub, listed compressions, 2(g) reflow; V8/L12 re-pinned |

`grep -c 'retro validate' 06-verify.md` = 0. a1-new-feature default path (SKILL.md + 00-06 workflows): `cat skills/a1-new-feature/SKILL.md skills/a1-new-feature/workflows/0*.md | wc -l` = 2355 (target at most 2360; SC-006 below 2378). 06-verify wc -l 410 (cap 412), no line over 300 characters.
Pre-merge check 14 text lines, failure path 16, Diana 12 (heading to last bullet), Tobi 3.

RED-proof 8.1 a old V8/L12 lists on the new tree -> V8 and L12 red (`06-verify.md:0/0`), measured before the re-pin (rc=1)
RED-proof 8.1 b `| cat` after the validate line in retro-prose.md -> V8 red (piped=retro-prose.md) and L12 `retro-prose.md:1/0` red (rc=1)
RED-proof 8.1 c measured grep: with only the Step 6 move and no 2(g) edit, `grep -c 'retro validate' 06-verify.md` = 1 (line 329); after 2(g) it is 0
RED-proof 8.1 d same as c

Suites after Wave 8 (all green): a1-gates-lint 117, a1-kritis-profile 228, a1-retro-validate 67, plus the Wave 7 list unchanged.

## Wave 9 — other skills
| Task | Status | Commit | Notes |
|---|---|---|---|
| 9.1 | DONE | 8544e4d | multi-lane.md (39 lines), a1-execute SKILL.md 234 -> 203, a1-fix item 1 one-line pointer (272 -> 267), markers on a1-quick (88, 281), a1-pr-review (139), a1-fix (166); :336-340 pin exclusion dropped |

Action 6 grep (outside a1-worktree, without marker, without 05-merge.md) prints nothing. 05-merge.md:98 stays for Task 10.2.
RED-proof 9.1 a measured order: the multi-lane pointer line (181) sits below the `lane-split check` fence (176); placed above the fence it would be an RD3-shaped finding (rule runs in Task 11.1)
RED-proof 9.1 b `lane-split check` fence moved into multi-lane.md -> W11 red: `skills/a1-execute/SKILL.md: lane-split check expected 1 call(s), found 0`
RED-proof 9.1 c the old exclusion on the c6b10a2 tree: the stale scan lists `skills/a1-new-feature/SKILL.md` (so the dropped exclusion is meaningful)

Suites after Wave 9 (all green): same list as Wave 7, plus a1-gates-lint 117 and a1-kritis-profile 228.

## SC-006 arithmetic (lines, `wc -l`)
| Skill | c6b10a2 | now (default path) | Note |
|---|---|---|---|
| a1-new-feature | 2560 | 2355 | SKILL.md 461 -> 368, 06-verify 522 -> 410; kritis.md 40 and retro-prose.md 63 are conditional |
| a1-execute | 1121 | 1090 | SKILL.md 234 -> 203; multi-lane.md 39 conditional |
| a1-fix | 1183 | 1178 | SKILL.md 272 -> 267 |
| a1-quick, a1-pr-review | unchanged | unchanged | markers appended to existing lines |

## Deferred pins
None. No suite outside the lane's files went red that needed a deferred edit (the kritis, retro-validate and a1-pr-review pins are in the lane's pin table).

## Deviations
- Unlisted pin: kritis R mutation (above). Name it in the PR text.
- Per-wave verify gate: a lock_timeout (another lane held /tmp/a1-verify-lock-1000 for more than 900000 ms) on Wave 7; see the verify lines below.

## Per-wave verify gate
`verify run --affected --no-cache` was started three times (after Wave 7, and twice on the Wave 9 head, with A1_VERIFY_LOCK_WAIT_MS=900000, the maximum). Each attempt ended `lock_timeout` after 900000 ms: other lanes held /tmp/a1-verify-lock-1000 (PIDs 2842475, 4131093, 654705). The gate did not run, so there is no verdict. The suites it would cover were run directly instead (lists above, all green on the head). The orchestrator should re-run the gate on this lane's head when the host is quiet.
Fast gates on the Wave 9 head against 599d1ad: check-assert-deletions deleted=0; test-fidelity status clean (0 findings); realpath-check PASS; `workflow lint --root . --phase 027-lean-pipeline-s5` ran without a finding line in the tail.
