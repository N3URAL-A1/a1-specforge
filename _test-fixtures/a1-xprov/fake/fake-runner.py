#!/usr/bin/env python3
"""Fake claudex-loop runner for the a1-xprov fixture suite. Never calls Codex.

The harness copies `_shared/` into a temp dir and swaps THIS file in for the
vendored `runner.py` (regenerating the copy's SHA256SUMS), because production
code resolves the runner relative to its own module and offers no override
flag: the only way to run a fake is to own the tree.

Knobs. Production `xprov run` hands the runner an ALLOWLISTED environment
(PATH, HOME, TMPDIR, LANG, LC_*, TERM, USER, SHELL + CODEX_HOME), so knobs
cannot travel as environment variables through `run`. The fake therefore reads
them from `fake-runner.env.json` NEXT TO ITSELF (the harness owns that tree and
writes the file per call via `fake_runner_env`), and falls back to the real
environment when the file is absent (direct `python3 fake-runner.py` calls).

  FAKE_RUNNER_ARGV_FILE        write sys.argv (JSON array, one line) here
  FAKE_RUNNER_ENV_FILE         write the child's WHOLE environment as JSON here
  FAKE_RUNNER_CASE             case to copy into <artifacts>/<run>/result.json —
                               a file path, or a name resolved as
                               $FAKE_RUNNER_CASES_DIR/<name>.result.json
  FAKE_RUNNER_CASES_DIR        set by the harness (make_tree) to cases/
  FAKE_RUNNER_REPLY            content (or path of a file) written to <run>/reply.txt
  FAKE_RUNNER_SIDE_EFFECT      `write-into-repo` writes one file into --repo (tripwire)
  FAKE_RUNNER_WRITE_PATH       write one probe file at this ABSOLUTE path (any dir:
                               checkout .git/hooks, the dedicated home, …)
  FAKE_RUNNER_HEADER_ARTIFACTS override the `artifacts` value of the stdout header
                               (Samuel W5 MAJOR 1: a hostile header must not make
                               a1 delete that directory)
  FAKE_RUNNER_REFUSE=1         mimic a pre-run_dir refusal: one `claudex-loop: <msg>`
                               line on stderr, NO run dir, NO JSON, exit 1
  FAKE_RUNNER_EXIT             exit code (default 0)

Mirrors the measured runner behaviours a1 depends on: the run directory is
`mkdtemp(prefix="claudex-", dir=<artifacts>)`; an --artifacts path inside
--repo is refused; in inspect mode `--base` must resolve INSIDE --repo (the
real runner runs `git rev-parse <base>^{commit}` + `git diff <base>` there — a
snapshot that is one commit too shallow makes it fail with a `claudex-loop: …`
line and exit 1). stdout mirrors the real shape: one header line
{provider, model, mode, artifacts}, then the record.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

EXIT_REFUSED = 1
EXIT_BAD_CASE = 98
ENV_FILE_NAME = "fake-runner.env.json"


def knobs() -> dict:
    """FAKE_RUNNER_* from the sibling env file, else from the environment."""
    sibling = Path(__file__).with_name(ENV_FILE_NAME)
    if sibling.is_file():
        try:
            data = json.loads(sibling.read_text(encoding="utf-8"))
            return {k: str(v) for k, v in data.items() if k.startswith("FAKE_RUNNER_")}
        except (OSError, ValueError):
            return {}
    return {k: v for k, v in os.environ.items() if k.startswith("FAKE_RUNNER_")}


def flag(argv: list[str], name: str) -> str | None:
    for i, arg in enumerate(argv):
        if arg == name and i + 1 < len(argv):
            return argv[i + 1]
        if arg.startswith(name + "="):
            return arg.split("=", 1)[1]
    return None


def resolve_case(spec: str | None, cases_dir: str | None) -> Path | None:
    if not spec:
        return None
    direct = Path(spec)
    if direct.is_file():
        return direct
    if cases_dir:
        named = Path(cases_dir) / f"{spec}.result.json"
        if named.is_file():
            return named
    sys.stderr.write(f"fake-runner: case not found: {spec}\n")
    sys.exit(EXIT_BAD_CASE)


def write_reply(run_dir: Path, reply: str | None) -> None:
    if reply is None:
        return
    source = Path(reply)
    if source.is_file():
        shutil.copyfile(source, run_dir / "reply.txt")
    else:
        (run_dir / "reply.txt").write_text(reply, encoding="utf-8")


def make_run_dir(artifacts: str, repo: str | None) -> Path:
    root = Path(artifacts).resolve()
    if repo:
        repo_path = Path(repo).resolve()
        if root == repo_path or repo_path in root.parents:
            sys.stderr.write("fake-runner: Keep run artifacts outside the target checkout.\n")
            sys.exit(EXIT_REFUSED)
    root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="claudex-", dir=root))


def base_resolves(repo: str | None, base: str | None) -> bool:
    """The real runner's snapshot(repo, base) runs git rev-parse <base>^{commit} in --repo."""
    if not repo or not base:
        return True
    r = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", base + "^{commit}"],
                       capture_output=True)
    return r.returncode == 0


def main(argv: list[str]) -> int:
    k = knobs()
    argv_file = k.get("FAKE_RUNNER_ARGV_FILE")
    if argv_file:
        Path(argv_file).write_text(json.dumps(argv) + "\n", encoding="utf-8")
    env_file = k.get("FAKE_RUNNER_ENV_FILE")
    if env_file:
        Path(env_file).write_text(json.dumps(dict(os.environ), indent=1) + "\n", encoding="utf-8")
    if k.get("FAKE_RUNNER_REFUSE") == "1":
        sys.stderr.write("claudex-loop: Keep run artifacts outside the target checkout so they do not contaminate its diff.\n")
        return EXIT_REFUSED
    mode = argv[1] if len(argv) > 1 else None
    artifacts = flag(argv, "--artifacts")
    repo = flag(argv, "--repo")
    if mode == "inspect" and not base_resolves(repo, flag(argv, "--base")):
        sys.stderr.write("claudex-loop: fatal: bad revision — --base is not reachable in the snapshot (too shallow?)\n")
        return EXIT_REFUSED
    run_dir = make_run_dir(artifacts, repo) if artifacts else None
    if run_dir is not None:
        case = resolve_case(k.get("FAKE_RUNNER_CASE"), k.get("FAKE_RUNNER_CASES_DIR"))
        if case is not None:
            shutil.copyfile(case, run_dir / "result.json")
        write_reply(run_dir, k.get("FAKE_RUNNER_REPLY"))
        (run_dir / "command.json").write_text(json.dumps(argv, indent=2) + "\n", encoding="utf-8")
    if k.get("FAKE_RUNNER_SIDE_EFFECT") == "write-into-repo" and repo:
        (Path(repo) / "FAKE_RUNNER_WROTE_THIS.txt").write_text("tripwire probe\n", encoding="utf-8")
    write_path = k.get("FAKE_RUNNER_WRITE_PATH")
    if write_path:
        target = Path(write_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("tripwire probe\n", encoding="utf-8")
    header_artifacts = k.get("FAKE_RUNNER_HEADER_ARTIFACTS") or (str(run_dir) if run_dir else None)
    header = {"provider": "codex", "model": flag(argv, "--model") or "CLI default (unresolved)",
              "mode": mode, "artifacts": header_artifacts}
    print(json.dumps(header), flush=True)
    if run_dir is not None and (run_dir / "result.json").is_file():
        print((run_dir / "result.json").read_text(encoding="utf-8"))
    return int(k.get("FAKE_RUNNER_EXIT", "0"))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
