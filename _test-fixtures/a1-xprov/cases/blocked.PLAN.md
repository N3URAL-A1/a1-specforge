# Plan: implement the contract in the external specification

## Goal
Implement `subtract(a, b)` in src/add.js exactly as defined by the binding
specification, which is NOT part of this repository.

## Required evidence
The behaviour (argument order, integer overflow handling, error cases) is
defined ONLY in the specification at
https://spec.example.invalid/arith/v3/subtract.md and in the signed PDF at
/Volumes/legal-spec/arith-v3.pdf. The plan does not restate the contract.
A review that has not read both documents cannot judge whether the tasks
below are correct.

## Tasks
1. Implement `subtract` per section 4.2 of the specification.
2. Add the test cases listed in appendix B of the specification.

## Acceptance checks
- All appendix-B cases pass.
