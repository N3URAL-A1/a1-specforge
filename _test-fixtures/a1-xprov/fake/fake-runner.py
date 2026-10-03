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
  FAKE_RUNNER_CWD_FILE         write os.getcwd() (realpath) here
  FAKE_RUNNER_HOME_WRITE       write one file at $HOME/<this relative path> — what
                               Codex leaves in the per-run HOME (Wave 7)
  FAKE_RUNNER_SKILLS_FILE      write the names under $HOME/.agents/skills (JSON
                               array) here — the skill root Codex reads from $HOME
  FAKE_RUNNER_SYSTEM_PROBE     like Codex (measured m2, 2026-10-03): re-extract
                               $CODEX_HOME/skills/.system when absent (marker
                               8bcfb84cfbe4722a + one skill), then write the names
                               it would load from .system (JSON array) here
  FAKE_RUNNER_CODEX_STDOUT     a captured codex stdout (file path or case name
                               <name>.codex-stdout.txt): copied to <run>/stdout.txt,
                               result.json status failed + the runner's own error
                               text (runner.py:366), exit 1
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

A resume is checked like runner.py:257-269 (same repo, plan, provider, mode,
model, effort; status completed; a session UUID) — the check whose absence
let a1's resumed plan review pass every fixture while it could never run live.

Mirrors the measured runner behaviours a1 depends on (Wave 7 adds two, ported
from runner.py 2.1.0, never from a1's code): the record carries the resolved
`repo` and `plan` the run used (runner.py:301-304), and in inspect mode
`snapshot` = {base, files, diff_sha256, sha256} computed exactly like
runner.py:86-108 (`git diff --no-ext-diff --no-textconv --binary <base> --`);
 the run directory is
`mkdtemp(prefix="claudex-", dir=<artifacts>)`; an --artifacts path inside
--repo is refused; in inspect mode `--base` must resolve INSIDE --repo (the
real runner runs `git rev-parse <base>^{commit}` + `git diff <base>` there — a
snapshot that is one commit too shallow makes it fail with a `claudex-loop: …`
line and exit 1). stdout mirrors the real shape: one header line
{provider, model, mode, artifacts}, then the record.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

EXIT_REFUSED = 1
SYSTEM_MARKER = "8bcfb84cfbe4722a\n"  # measured content of .codex-system-skills.marker (codex-cli 0.155.1)
RUNNER_CODEX_FAILED = "codex exited 1; inspect stdout.txt and stderr.txt."  # runner.py:366
SIZE_PROBE_BYTES = 1024 * 1024  # no real record comes near; only padded size probes
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


def git_bytes(repo: str, *args: str) -> bytes:
    r = subprocess.run(["git", *args], cwd=repo, capture_output=True, timeout=30)
    if r.returncode:
        raise SystemExit(f"fake-runner: git {' '.join(args)}: {r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def runner_snapshot(repo: str, base: str) -> dict:
    """Port of runner.py 2.1.0 snapshot() (lines 86-108)."""
    base_id = git_bytes(repo, "rev-parse", "--verify", base + "^{commit}").decode().strip()
    tracked = git_bytes(repo, "diff", "--no-ext-diff", "--name-only", "-z", base_id, "--")
    untracked = git_bytes(repo, "ls-files", "--others", "--exclude-standard", "-z")
    names = sorted(set(os.fsdecode(n) for n in (tracked + untracked).split(b"\0") if n))
    files = []
    for name in names:
        path = Path(repo) / name
        if path.is_symlink():
            body, kind = os.fsencode(os.readlink(path)), "symlink"
        elif path.is_file():
            body, kind = path.read_bytes(), "file"
        else:
            body, kind = b"", "deleted"
        files.append({"path": name, "kind": kind, "sha256": digest(body)})
    diff = git_bytes(repo, "diff", "--no-ext-diff", "--no-textconv", "--binary", base_id, "--")
    value = {"base": base_id, "files": files, "diff_sha256": digest(diff)}
    value["sha256"] = digest(json.dumps(value, sort_keys=True).encode())
    return value


def stamp_record(run_dir: Path, mode: str | None, repo: str | None, plan: str | None, base: str | None,
                 model: str | None = None, effort: str | None = None) -> None:
    """repo/plan/requested_model/requested_effort as the real runner records
    them from its own argv (runner.py:301-304); snapshot in inspect mode."""
    target = run_dir / "result.json"
    if target.stat().st_size > SIZE_PROBE_BYTES:
        return  # a padded size-probe case (R18d3c) keeps its exact bytes
    try:
        record = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return  # malformed/empty cases stay byte-identical
    if not isinstance(record, dict):
        return
    if repo:
        record["repo"] = str(Path(repo).resolve())
    if plan:
        record["plan"] = str(Path(plan).resolve())
    record["requested_model"] = model
    record["requested_effort"] = effort
    if mode == "inspect" and repo and base:
        record["snapshot"] = runner_snapshot(repo, base)
    target.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")


def previous_record_problem(resume: str, repo: str | None, plan: str | None, mode: str | None,
                            model: str | None, effort: str | None) -> str | None:
    """Port of runner.py 2.1.0 previous_record() (lines 257-269): a resume must
    name the same repo, plan, provider, mode, model and effort, and a completed
    record with a valid session UUID — else the runner refuses."""
    record = json.loads(Path(resume).read_text(encoding="utf-8"))
    expected = {"repo": str(Path(repo).resolve()) if repo else None,
                "plan": str(Path(plan).resolve()) if plan else None,
                "provider": "codex", "mode": mode, "requested_model": model,
                "requested_effort": effort, "status": "completed"}
    for key, value in expected.items():
        if record.get(key) != value:
            return f"Resume {key} does not match this run. Start fresh instead."
    try:
        uuid.UUID(record["session_id"])
    except (ValueError, KeyError, TypeError, AttributeError):
        return "Resume record has no valid session UUID."
    return None


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
    cwd_file = k.get("FAKE_RUNNER_CWD_FILE")
    if cwd_file:
        Path(cwd_file).write_text(os.path.realpath(os.getcwd()), encoding="utf-8")
    skills_file = k.get("FAKE_RUNNER_SKILLS_FILE")
    if skills_file:
        root = Path(os.environ.get("HOME", "/nonexistent")) / ".agents" / "skills"
        names = sorted(p.name for p in root.iterdir()) if root.is_dir() else []
        Path(skills_file).write_text(json.dumps(names), encoding="utf-8")
    system_probe = k.get("FAKE_RUNNER_SYSTEM_PROBE")
    if system_probe:
        sysdir = Path(os.environ["CODEX_HOME"]) / "skills" / ".system"
        if not sysdir.is_dir():
            (sysdir / "imagegen").mkdir(parents=True, exist_ok=True)
            (sysdir / ".codex-system-skills.marker").write_text(SYSTEM_MARKER, encoding="utf-8")
            (sysdir / "imagegen" / "SKILL.md").write_text("---\nname: imagegen\n---\n", encoding="utf-8")
        Path(system_probe).write_text(json.dumps(sorted(p.name for p in sysdir.iterdir()), separators=(",", ":")), encoding="utf-8")
    home_write = k.get("FAKE_RUNNER_HOME_WRITE")
    if home_write:
        target = Path(os.environ["HOME"]) / home_write
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("runtime probe\n", encoding="utf-8")
    if k.get("FAKE_RUNNER_REFUSE") == "1":
        sys.stderr.write("claudex-loop: Keep run artifacts outside the target checkout so they do not contaminate its diff.\n")
        return EXIT_REFUSED
    mode = argv[1] if len(argv) > 1 else None
    artifacts = flag(argv, "--artifacts")
    repo = flag(argv, "--repo")
    resume = flag(argv, "--resume")
    if resume:
        problem = previous_record_problem(resume, repo, flag(argv, "--plan"), mode, flag(argv, "--model"), flag(argv, "--effort"))
        if problem:
            sys.stderr.write(f"claudex-loop: {problem}\n")
            return EXIT_REFUSED
    if mode == "inspect" and not base_resolves(repo, flag(argv, "--base")):
        sys.stderr.write("claudex-loop: fatal: bad revision — --base is not reachable in the snapshot (too shallow?)\n")
        return EXIT_REFUSED
    run_dir = make_run_dir(artifacts, repo) if artifacts else None
    if run_dir is not None:
        case = resolve_case(k.get("FAKE_RUNNER_CASE"), k.get("FAKE_RUNNER_CASES_DIR"))
        if case is not None:
            shutil.copyfile(case, run_dir / "result.json")
            stamp_record(run_dir, mode, repo, flag(argv, "--plan"), flag(argv, "--base"), flag(argv, "--model"), flag(argv, "--effort"))
        write_reply(run_dir, k.get("FAKE_RUNNER_REPLY"))
        (run_dir / "command.json").write_text(json.dumps(argv, indent=2) + "\n", encoding="utf-8")
    if k.get("FAKE_RUNNER_SIDE_EFFECT") == "write-into-repo" and repo:
        (Path(repo) / "FAKE_RUNNER_WROTE_THIS.txt").write_text("tripwire probe\n", encoding="utf-8")
    write_path = k.get("FAKE_RUNNER_WRITE_PATH")
    if write_path:
        target = Path(write_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("tripwire probe\n", encoding="utf-8")
    codex_stdout = k.get("FAKE_RUNNER_CODEX_STDOUT")
    if codex_stdout and run_dir is not None:
        src = Path(codex_stdout)
        if not src.is_file() and k.get("FAKE_RUNNER_CASES_DIR"):
            src = Path(k["FAKE_RUNNER_CASES_DIR"]) / f"{codex_stdout}.codex-stdout.txt"
        shutil.copyfile(src, run_dir / "stdout.txt")
        (run_dir / "stderr.txt").write_text("", encoding="utf-8")
        failed = {"status": "failed", "mode": mode, "provider": "codex", "repo": str(Path(repo).resolve()) if repo else None,
                  "error": RUNNER_CODEX_FAILED, "exit_code": 1}
        (run_dir / "result.json").write_text(json.dumps(failed, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"provider": "codex", "model": "CLI default (unresolved)", "mode": mode, "artifacts": str(run_dir)}), flush=True)
        print(json.dumps(failed, indent=2))
        return 1
    header_artifacts = k.get("FAKE_RUNNER_HEADER_ARTIFACTS") or (str(run_dir) if run_dir else None)
    header = {"provider": "codex", "model": flag(argv, "--model") or "CLI default (unresolved)",
              "mode": mode, "artifacts": header_artifacts}
    print(json.dumps(header), flush=True)
    if run_dir is not None and (run_dir / "result.json").is_file():
        print((run_dir / "result.json").read_text(encoding="utf-8"))
    return int(k.get("FAKE_RUNNER_EXIT", "0"))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
