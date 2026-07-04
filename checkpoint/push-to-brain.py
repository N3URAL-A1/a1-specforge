#!/usr/bin/env python3
"""push-to-brain.py — push given vault .md files into the Cloud-MT-Brain via the proxy.

Used by the checkpoint skill (Step 3b) to keep the cloud brain in sync with the
notes written to the Obsidian Vault in Step 3. Stdlib-only (no fastmcp / venv).
Idempotent: write_note with overwrite=True. Wikilinks in the body stay → graph relations.

Usage:
    BRAIN_ROBERT_TOKEN="$(security find-generic-password -s brain-robert-token -w)" \
        python3 push-to-brain.py <vault-file1.md> <vault-file2.md> ...

Directory in the brain = the file's path relative to the vault root (preserves the
7-Typen-IA structure: project/, pattern/, record/, ...).
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

VAULT = Path(os.path.expanduser("~/N3URAL-Vault"))
BASE = os.environ.get("BRAIN_MCP_URL", "https://brain-proxy-mt-production.up.railway.app/mcp")
TOKEN = os.environ["BRAIN_ROBERT_TOKEN"]
FM = re.compile(r"^---\n.*?\n---\n", re.DOTALL)


def _post(payload: dict, session: str | None = None):
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if session:
        headers["mcp-session-id"] = session
    req = urllib.request.Request(BASE, data=json.dumps(payload).encode(), headers=headers, method="POST")
    resp = urllib.request.urlopen(req, timeout=60)
    sid = resp.headers.get("mcp-session-id")
    data = None
    for line in resp.read().decode().splitlines():
        if line.startswith("data:"):
            data = json.loads(line[5:].strip())
    return sid, data


def parse(path: Path):
    raw = path.read_text(encoding="utf-8")
    body = raw.strip()
    while body.startswith("---"):
        s = FM.sub("", body, count=1)
        if s == body:
            break
        body = s.strip()
    m = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
    title = m.group(1).strip() if m else path.stem
    if not body.startswith("#"):
        body = f"# {title}\n\n{body}"
    rel = path.relative_to(VAULT).parent.as_posix()
    directory = rel if rel and rel != "." else "main"
    return title, body, directory


def main() -> None:
    files = [Path(a) for a in sys.argv[1:] if a.endswith(".md")]
    if not files:
        print("[brain-sync] no .md files given")
        return
    sid, _ = _post({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "checkpoint", "version": "1"}},
    })
    _post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    ok = fail = 0
    for f in files:
        try:
            title, content, directory = parse(f)
            _, data = _post({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": {"name": "write_note", "arguments": {
                    "title": title, "content": content, "directory": directory,
                    "project": "main", "overwrite": True}},
            }, sid)
            if data and data.get("result", {}).get("isError"):
                fail += 1
                print(f"  FAIL {f.name}: {str(data)[:120]}")
            else:
                ok += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  FAIL {f.name}: {e}")
    print(f"[brain-sync] {ok} ok, {fail} fail")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
