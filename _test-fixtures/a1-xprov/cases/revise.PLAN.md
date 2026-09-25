# Plan: rename add() to sum()

## Goal
Rename the exported function `add` in src/add.js to `sum` so the module name
matches the team's naming convention.

## Tasks
1. In src/add.js, replace `export function add(a, b)` with `export function sum(a, b)`.
2. Remove the old `add` export entirely; no alias is kept.

## Acceptance checks
- `node --test` passes.
- src/add.js exports exactly one function named `sum`.

## Out of scope
- No other file is changed in this plan.
