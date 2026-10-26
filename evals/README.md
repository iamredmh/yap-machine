# Agent evals

Does an agent, given only the skill, turn a messy take into a clean cut? These evals answer that with
a synthetic take whose right answer is known, and a deterministic grader (no LLM opinion).

```bash
uv run python evals/run.py --solution          # reference EDL, local transcription, render and checks
uv run python evals/run.py --agent claude --model sonnet --budget 4
```

- **Fixture** (`fixture.py`): a macOS system voice reads a script with chatter, a false start, a line said
  badly then well, and a line broken off and redone. No real person's footage is in the repo. It builds to
  `.evals-cache/` (git-ignored). Needs macOS `say`.
- **Agent run**: Claude Code in print mode, from a throwaway folder, with the engine skill as a project skill
  and one sentence of task ("make it into a clean video"). It isn't told which commands to run, so this
  tests whether the skill is found and followed. `--setting-sources project` and `--strict-mcp-config`
  keep your user settings, hooks and connectors out of it; your global CLAUDE.md can still load (context
  only). Your agent configuration is never touched.
- **The false start** is a fragment that can't stand alone ("Today we're gonna look at- no, hang on."). An earlier fixture put a whole greeting inside it, so keeping it was a fair editorial choice and the first real agent run (17/18) failed on a contested rule. Results from before this change aren't comparable.
- **Grading**: the cut keeps each good line, drops each bad fragment, says each line once, has a plausible
  length, QC reports no errors, loudness is -14 LUFS. Results go to `evals/results/` (git-ignored).
- **Sign-in**: the agent run needs `claude` to be logged in on its own (`claude` in a terminal). It can't
  borrow a desktop app's session; the harness says so if it can't sign in.

The reference solution picks phrases by what they say, so it doesn't depend on how Whisper numbers or splits them. The reference matcher depends on the transcript containing the expected words. In the October 2026 QA run, the local base model heard “savor cup” instead of “save a cup”, so the unmodified reference run stopped before creating an EDL. A separate run with that transcript corrected passed all 19 downstream checks. Review transcription errors rather than treating the corrected run as an automatic-transcription pass. Runtime and warnings depend on the machine, model and source.

Add a case by adding a fixture with its own `GOOD`, `BAD` and `ONCE` lists and pointing `run.py` at it.
