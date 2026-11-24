# STATUS lane retro (Waves 3-4)

## Wave 3 - Machine retro module
| Task | Status | Commit | Notes |
|---|---|---|---|
| T3.1 machine-retro.cjs, mergeByTs export, MR1-MR11 | DONE | e698d61, 8ca4657 | 139 lines (cap 220); retro-gatelog.cjs 124 -> 124 (one line changed) |

RED-proof 3.1 (a) mergeByTs replaced by plain concatenation -> MR1 red
RED-proof 3.1 (b) proseDecision ignores caught -> MR4 red (MR3 entry-keys case too)
RED-proof 3.1 (c) no idempotency check -> MR8 red
RED-proof 3.1 (d) retro-* scopes kept -> MR10 red
RED-proof 3.1 (e) item without `caught` -> MR3 retro validate stayed exit 0 (it does not require `caught`): fixture defect. Fixed by adding an item-format assert to MR3 (8ca4657); re-run: MR3 item-format assert red.

## Wave 4 - feature close machine record
| Task | Status | Commit | Notes |
|---|---|---|---|
| T4.1 --issues, decideRetro, machineRetro, help-lean, FR1-FR8 | DONE | 4eb9a89 + fix commit | feature-close.cjs 361 lines (cap 420), help-lean.cjs 74 (cap 140) |

RED-proof 4.1 (a) machineRetro after exitWorktree -> FR1 red (+FR2, FR3, FR4, FR8)
RED-proof 4.1 (b) decideRetro out of the check-only plan -> FR1, FR3, FR8 red (needed: the post-plan fallback no longer runs in check-only mode)
RED-proof 4.1 (c) issues regex accepts `;` -> FR5 red
RED-proof 4.1 (d) missing store throws -> FR7 red
RED-proof 4.1 (e) old help-lean usage-line assert on the new tree -> H2 red
RED-proof 4.1 (f) --issues removed from the usage line -> new H2 assert red

### Deviations
- D1 (Rule 3 spirit): `retro` carries an extra field `source` (worktree|stored|none) and, for a stored record, `gates_fired: []`, `result: null`; plan listed only four fields. Additive.
- D2: an unreadable gate log at close writes NO machine record (warning, step skipped; fail closed) and the check-only decision names `gate_log_unreadable`. Plan D6 only specified the decision.
- D3: no `retro-decision` step is pushed into `steps[]` (existing check-only step assertions stay valid); decideRetro is the last step of the check-only plan and runs after the close plan only when no worktree entry existed.
- D4: a stored record with prose_required true reports reason `stored_record`.
- No deferred pins. Fenced a1-tools call lines untouched, so the W11/W13/W14/H7a sweeps were not required; W13/W14 ran green anyway.
- Shared scratchpad: another lane overwrote my `red.sh`; renamed to `retro-red.sh`.
