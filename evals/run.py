"""Evaluate whether an agent, given only the skill, can turn the messy fixture take into a clean cut.

    uv run python evals/run.py --solution          # no agent: a reference EDL, to prove fixture and grader agree
    uv run python evals/run.py --agent claude      # Claude Code in print mode, in a throwaway folder
    uv run python evals/run.py --agent claude --model sonnet --budget 3

The agent gets the engine skill as a project skill and the footage folder, and one sentence of
task. It is not told which commands to run. Grading is deterministic (text of the resulting cut,
QC result, loudness), never an LLM's opinion, and results are written to evals/results/.

Isolation: the agent runs from a temp folder with --setting-sources project and no MCP servers, so
it does not load your user settings, hooks or connectors. Your global CLAUDE.md can still load; that
is context only. Nothing here touches your agent configuration.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import fixture  # noqa: E402

# The finished takes of the fixture, by what they say, with the beat each belongs to.
REFERENCE_LINES = [
    ("three things about cooking pasta", "hook", "the complete line; the take before it stops short"),
    ("until it tastes like the sea", "one", "finished; the earlier tries are a first go and a broken-off one"),
    ("because the starch helps the sauce stick", "two", "gives the reason; the first go has none"),
    ("save a cup of the cooking water", "three", "only take"),
    ("thanks for watching", "close", "only take"),
]


def reference_edl(phrases: list[dict]) -> dict:
    """The right answer as an EDL, found by what each phrase says, so it does not depend on how
    Whisper numbered or split the phrases."""
    ranges = []
    for key, beat, why in REFERENCE_LINES:
        hit = next((p for p in phrases if key in plain(p["text"])), None)
        if hit is None:
            raise SystemExit(f"the fixture's transcript has no phrase saying “{key}”")
        ranges.append({"from": hit["id"], "to": hit["id"], "quote": " ".join(hit["text"].split()[:4]), "beat": beat, "why": why})
    return {"brief": "Three things about cooking pasta, 16:9, best take of every line.", "format": {"width": 1280, "height": 720}, "ranges": ranges}


def plain(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]", " ", text.lower())).strip()


def latest_version(project: Path) -> str | None:
    vs = sorted((p.name for p in (project / "cuts").glob("v*") if re.fullmatch(r"v\d+", p.name)), key=lambda v: int(v[1:])) \
        if (project / "cuts").is_dir() else []
    return vs[-1] if vs else None


def grade(project: Path) -> list[tuple[str, bool, str]]:
    checks: list[tuple[str, bool, str]] = []
    v = latest_version(project)
    if not v:
        return [("a cut exists", False, "no cuts/vN/ in the project")]
    tl_path, qc_path, render = project / "cuts" / v / "timeline.json", project / "cuts" / v / "qc.md", project / "renders" / f"{v}.mp4"
    checks.append((f"{v} was resolved", tl_path.exists(), str(tl_path)))
    checks.append((f"{v} was rendered (full quality)", render.exists(), str(render)))
    if not tl_path.exists():
        return checks
    tl = json.loads(tl_path.read_text())
    text = plain(" ".join(s["text"] for s in tl["segments"]))
    for g in fixture.GOOD:
        checks.append((f"keeps: “{g}”", g in text, ""))
    for b in fixture.BAD:
        checks.append((f"drops: “{b}”", b not in text, ""))
    for o in fixture.ONCE:
        n = text.count(o)
        checks.append((f"says “{o}” once", n == 1, f"{n}×"))
    checks.append(("length is plausible (15–40 s)", 15 <= tl["duration"] <= 40, f"{tl['duration']:.1f}s"))
    if qc_path.exists():
        qc = qc_path.read_text()
        m = re.search(r"## Errors \((\d+)\)", qc)
        n = int(m.group(1)) if m else -1
        checks.append(("QC reports no errors", n == 0, f"{n} errors"))
        lu = re.search(r"loudness ([-\d.]+) LUFS", qc)
        if lu:
            checks.append(("loudness is -14 LUFS ±1.5", abs(float(lu.group(1)) + 14) <= 1.5, f"{lu.group(1)} LUFS"))
    else:
        checks.append(("QC was run", False, "no qc.md"))
    return checks


def clean_env(env: dict) -> dict:
    """The evaluated agent must stand on its own: drop the variables a host app (Claude desktop,
    an SDK session) sets for the session that launched this script, so the child neither inherits
    that session nor its proxy and uses the CLI's own login, as it would from a terminal."""
    drop = ("CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK_", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_PREVIEW_", "ANTHROPIC_BASE_URL",
            "__CFBundleIdentifier")
    return {k: v for k, v in env.items() if not k.startswith(drop)}


def shim(bindir: Path) -> None:
    """A `yap-machine` on PATH that runs this checkout, so the eval needs no global install."""
    bindir.mkdir(parents=True, exist_ok=True)
    p = bindir / "yap-machine"
    p.write_text(f'#!/bin/sh\nexec uv run --quiet --project "{REPO}" yap-machine "$@"\n')
    p.chmod(0o755)


def yap(args: list[str], env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(["yap-machine", *args], capture_output=True, text=True, env=env)


def run_solution(work: Path, env: dict, footage: Path) -> dict:
    project = work / "project"
    for step in (["init", str(project), "--footage", str(footage)], ["prep", "-p", str(project)]):
        r = yap(step, env)
        if r.returncode:
            sys.exit(f"yap-machine {' '.join(step)} failed:\n{r.stderr[-800:]}")
    (project / "cuts" / "v1").mkdir(parents=True)
    (project / "cuts" / "v1" / "edl.json").write_text(json.dumps(reference_edl(json.loads((project / "phrases.json").read_text())), indent=2))
    r = yap(["cut", "v1", "-p", str(project)], env)
    return {"mode": "solution", "exit": r.returncode, "log": (r.stdout + r.stderr)[-1500:]}


def run_agent(work: Path, env: dict, footage: Path, model: str | None, budget: float | None, timeout: int) -> dict:
    project = work / "project"
    skill_dir = work / ".claude" / "skills" / "yap-machine"
    skill_dir.mkdir(parents=True)
    shutil.copy(REPO / "skill" / "SKILL.md", skill_dir / "SKILL.md")
    task = (f"There's raw to-camera footage in {footage}. It's messy: false starts, retakes, chatter between takes. "
            f"Make it into a clean video and put the project in {project}.")
    cmd = ["claude", "-p", task, "--output-format", "json", "--permission-mode", "acceptEdits",
           "--setting-sources", "project", "--strict-mcp-config", "--no-session-persistence",
           "--allowedTools", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill",
           "--add-dir", str(footage), "--add-dir", str(work)]
    if model:
        cmd += ["--model", model]
    if budget:
        cmd += ["--max-budget-usd", str(budget)]
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=work, capture_output=True, text=True, env=env, timeout=timeout, stdin=subprocess.DEVNULL)
        out, code = r.stdout, r.returncode
    except subprocess.TimeoutExpired as e:
        out, code = (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or ""), -9
    info: dict = {"mode": "agent", "exit": code, "seconds": round(time.time() - t0)}
    if any(w in out.lower() for w in ("authenticate", "not logged in", "/login")):
        info["note"] = "the agent could not sign in from here; run this from a normal terminal where `claude` works"
    try:
        j = json.loads(out)
        info.update({"turns": j.get("num_turns"), "cost_usd": j.get("total_cost_usd"), "result": (j.get("result") or "")[-1200:],
                     "is_error": j.get("is_error")})
    except json.JSONDecodeError:
        info["log"] = out[-1500:]
    return info


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--solution", action="store_true", help="use the reference EDL instead of an agent")
    g.add_argument("--agent", choices=["claude"], help="which agent to evaluate")
    ap.add_argument("--model", help="model for the agent (e.g. sonnet, opus)")
    ap.add_argument("--budget", type=float, help="stop the agent after this many dollars")
    ap.add_argument("--timeout", type=int, default=1500, help="seconds before giving up on the agent")
    ap.add_argument("--keep", action="store_true", help="keep the working folder")
    args = ap.parse_args()

    footage = fixture.build(REPO / ".evals-cache" / "pasta").parent
    work = Path(tempfile.mkdtemp(prefix="yap-eval-"))
    bindir = work / "bin"
    shim(bindir)
    env = {**clean_env(dict(os.environ)), "PATH": f"{bindir}:{os.environ['PATH']}"}
    info = run_solution(work, env, footage) if args.solution else run_agent(work, env, footage, args.model, args.budget, args.timeout)
    checks = grade(work / "project")
    passed = sum(1 for _, ok, _ in checks if ok)

    lines = [f"# Eval — {info['mode']}{' ' + (args.model or '') if args.agent else ''}", "", f"{time.strftime('%Y-%m-%d %H:%M')}  ·  **{passed}/{len(checks)} checks passed**", ""]
    lines += [f"- {k}: {v}" for k, v in info.items() if k not in ("result", "log") and v is not None]
    lines += ["", "| check | result | detail |", "|---|---|---|"] + [f"| {n} | {'pass' if ok else '**FAIL**'} | {d} |" for n, ok, d in checks]
    if info.get("result"):
        lines += ["", "## What the agent said", "", info["result"]]
    if info.get("log"):
        lines += ["", "## Log", "", "```", info["log"], "```"]
    res = HERE / "results"
    res.mkdir(exist_ok=True)
    out = res / f"{time.strftime('%Y%m%d-%H%M%S')}-{info['mode']}.md"
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\n→ {out}")
    if args.keep:
        print(f"working folder kept: {work}")
    else:
        shutil.rmtree(work, ignore_errors=True)
    sys.exit(0 if passed == len(checks) else 1)


if __name__ == "__main__":
    main()
