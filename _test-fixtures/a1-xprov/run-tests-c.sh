#!/usr/bin/env bash
# Fixture suite: a1-xprov, shard c — the parts listed in XP_SHARD_C of run-tests.sh (same harness, same checks).
# run-tests.sh runs the other parts; together they are the whole suite. See the "Shards" comment there.
exec bash "$(dirname "$0")/run-tests.sh" --shard c
