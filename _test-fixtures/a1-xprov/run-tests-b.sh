#!/usr/bin/env bash
# Fixture suite: a1-xprov, shard b — the parts listed in XP_SHARD_B of run-tests.sh (same harness, same checks).
# run-tests.sh runs the other parts; together they are the whole suite. See the "Shards" comment there.
A1_XPROV_SHARD=b exec bash "$(dirname "$0")/run-tests.sh" "$@"
