#!/usr/bin/env python3
"""Test stub for ~/.claude/skills/imagegen/scripts/generate.py (spec 024 W5).

Mirrors the real flag surface used by a1-ux-studio (--prompt=, --out=, --slug=, --n=; see
SOURCES.txt). A prompt containing FAIL-IMAGEGEN exits 1 and writes nothing. A prompt containing NO-SIDECAR writes the image only.
Otherwise it writes
<out> (a 1x1 PNG) and <stem>.json with the argv it received, so tests can assert the prompt
arrived as one literal argument.
"""
import argparse, json, pathlib, sys

PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082")

p = argparse.ArgumentParser()
p.add_argument("--prompt", default="")
p.add_argument("--out", default="")
p.add_argument("--slug", default="")
p.add_argument("--n", default="1")
a = p.parse_args()
if "FAIL-IMAGEGEN" in a.prompt:
    print("stub: generation failed", file=sys.stderr)
    sys.exit(1)
out = pathlib.Path(a.out)
out.write_bytes(PNG)
if "NO-SIDECAR" in a.prompt:
    sys.exit(0)
out.with_suffix(".json").write_text(json.dumps({"prompt": a.prompt, "slug": a.slug, "argv": sys.argv[1:]}))
