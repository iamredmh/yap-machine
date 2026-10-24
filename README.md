# Yap Machine

You recorded yourself talking. Several takes, false starts, "one more time",
a countdown, a mumble. Point your agent at the folder and get back a cut that
makes sense.

Yap Machine runs on your own computer. It does the
mechanical work (syncing a separate mic, transcribing, finding every attempt
at every line, timing cuts, rendering, checking). Your agent (Claude Code,
Codex, Cursor, anything that can run a command and edit a file) makes the
editorial calls.

## Install with your agent

Give an agent with local terminal and file access, such as Claude Code or Codex, this prompt:

> Install Yap Machine from https://github.com/iamredmh/yap-machine. Follow llms.txt, connect it to this agent, check the dependencies and open the local app. My footage is in ~/Movies/raw-takes.

Replace the footage path with your own. Your agent installs the engine and interface,
connects its review tools, checks dependencies and opens the desk in your browser.
[`llms.txt`](llms.txt) contains the installation steps for agents.

ChatGPT can follow this workflow when it has a connected runtime with local terminal
and file access. A chat session alone cannot install or run software on your computer.

## Install it yourself

Install [Git](https://git-scm.com/downloads), [Node.js 22.12 or newer](https://nodejs.org/en/download),
[uv](https://docs.astral.sh/uv/getting-started/installation/) and
[FFmpeg](https://ffmpeg.org/download.html) first. Then:

```bash
git clone https://github.com/iamredmh/yap-machine.git
cd yap-machine
./scripts/install
./scripts/start-desk
```

The installer creates a Python environment in the checkout, installs the desk and
style renderer dependencies, and builds the interface. The desk runs in the background.
Your projects live in `~/Yap`, separate from the application. To choose another
workspace, run `./scripts/start-desk /path/to/workspace`. To stop the desk, run
`node desk/dist/cli/index.js stop` (add `--home /path/to/workspace` for a custom workspace).

To connect an agent, run the installer with its name:

```bash
./scripts/install --agent=claude-code
# Or: --agent=codex, --agent=cursor, --agent=gemini, --agent=claude-desktop
```

This registers the local checkout with that agent and backs up any configuration it
changes. Restart the agent session to load the tools. The agent also needs local file
and terminal access to make edits; the review connection alone does not provide it.
Keep the checkout in its installed location so the connection continues to work.

This is a GitHub source installation. An npm or PyPI package is not required.

## What you need

Yap Machine doesn't bundle these. It uses tools you may already have:

| Tool | What for | Get it (macOS) |
|---|---|---|
| ffmpeg | cutting, rendering, audio | `brew install ffmpeg` |
| whisper.cpp + a model | transcription with word timings | `brew install whisper-cpp`, then the model (see below) |
| uv | manages the engine's Python environment (3.11+) | [Install uv](https://docs.astral.sh/uv/getting-started/installation/) |
| Node 22.12+ and npm | runs the desk and styles renderer | [Install Node.js](https://nodejs.org/en/download) |
| Chrome / Chromium | styled video export | Existing Chrome on macOS, or set `YAP_BROWSER` to the executable |
| Inter (optional) | caption and name-card typeface | `brew install --cask font-inter` |
| An agent | the editor: picks takes, writes cuts, translates | Claude Code, Codex, Cursor, Gemini CLI |

Run `./scripts/yap-machine doctor` to check the engine's tools and see setup guidance.
FFmpeg with libass supports burned-in captions; builds without it use the local
style renderer instead. Whisper and its model are needed for transcription and
speech-based quality checks. Styled export may download a
Chromium browser on first use if an existing one is not configured.

The source scripts target **macOS and Linux**. Person cutout effects require macOS
and Swift. Windows users can try WSL2; that route has not yet been verified.

## Transcription

On macOS, `brew install whisper-cpp` installs the speech tool. On Linux, follow
the [whisper.cpp build instructions](https://github.com/ggml-org/whisper.cpp).
Then run `./scripts/yap-machine doctor`; it prints a download command for a model
if none is found. For English, the suggested model can be installed with:

```bash
mkdir -p ~/.cache/yap/models
curl --fail --location \
  --output ~/.cache/yap/models/ggml-medium.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin
```

The model is a separate, potentially large download and stays on your computer.
Choose a multilingual Whisper model for other languages. You can add the speech
tools later when reviewing or styling a project that has already been prepared.

Existing supported models in `~/.cache/yap/models` are detected automatically.
Set `YAP_WHISPER_MODEL` to an absolute model file path to use a model elsewhere.
Preparing new footage and speech-based quality checks need whisper.cpp and a model.

## Status

The engine handles long cuts, vertical shorts, captions, name cards,
translations and screen recordings. The desk handles review, comparison,
notes, and direct style/effect editing. This checkout includes all six Style
Studio packs and 20 timed effects, with local preview and styled export.

## Use

```bash
./scripts/yap-machine init ~/Yap/my-video --footage ~/Movies/raw-takes
./scripts/yap-machine prep -p ~/Yap/my-video    # sync, transcribe, number every phrase → takes.md
# your agent reads takes.md and writes cuts/v1/edl.json
./scripts/yap-machine cut v1 -p ~/Yap/my-video # → render, script and quality checks
```

Give your agent [`skill/SKILL.md`](skill/SKILL.md). It explains the
workflow, the EDL format and the editorial rules. Commands run from the checkout;
use the absolute path to `scripts/yap-machine` when working elsewhere. No global
`yap-machine` executable is installed.

## Styles and effects

Open **Style & export** in the desk to apply Volt, Ledger, Sketch, Terminal, Glass or Pop
to your cut, choose its accent and motion, and add any of the 20 timed effects
from the reference video. Effects have editable timing, text, checklist items,
chart values, and image/video uploads where needed. Place a moment on a
transcript line or the playback position. Compare against the original, undo edits,
and export a separate styled MP4. The video stays visible beside the editing tools.
Unfinished style/effect edits recover after a refresh; Save writes them to the project.

The **Footage → Review → Style & export** navigation follows the editing flow.
Footage supports local drag-and-drop imports (up to 30 video/audio files and 500 MB
per import) or an existing folder for larger shoots. Preparing footage transcribes
and organizes it; your editing agent creates the first cut.

Styles need Node 22.12+ and Chromium. Person cutouts use
macOS Vision locally. The full style layouts are designed for vertical video;
wide cuts use styled captions and effects. See [studio/README.md](studio/README.md)
for setup, saved settings, CLI commands, platform support and credits.

## What it does under the hood

| Step | How |
|---|---|
| Separate mic | Cross-correlates it with the camera's own audio, uses the mic wherever it overlaps |
| Transcribe | whisper.cpp with DTW word timing, nudged to keep ums and restarts verbatim; word ends measured from the audio |
| Takes | Phrases numbered `P001…`, flagged `retake`, `cutoff`, `filler`, `lowconf`, `quiet`, and linked to every other attempt at the same line (`≈`) |
| Cut points | Snapped into the quietest 10 ms near each word edge; pauses tightened by context (sentence / comma / mid-clause); frame-aligned so sound never drifts |
| Jump cuts | Alternating 1.12× punch-in on cuts within one camera |
| Render | Per-segment cut with 15 ms fades, lossless join, two-pass loudness to −14 LUFS |
| Checks | Dead air, stray slivers, broken-off words, a line kept twice, something blocking the lens, A/V length, loudness |
| Cut edges | When sound runs across a cut edge that the transcript has no words for (Whisper dropped words or placed one off), the edge moves out to the quiet beyond it, and the move is reported |
| Re-listen | Transcribes the *render* and checks the words either side of every cut survived whole, none is heard twice, and the room sound carries across. A picture per join (frames, waveform, meant vs heard words) |
| Delivery | Pace, filler rate and pauses per recording and per minute, and a table comparing every attempt at the same line |

## More commands

```bash
./scripts/yap-machine delivery [v2] # pace, fillers and pauses
./scripts/yap-machine joins v2      # re-listen to every join; write join sheets
./scripts/yap-machine reference clip.mp4 --against v2 # measure a reference beside your cut
./scripts/yap-machine focus v2      # zoom suggestions for screen recordings
./scripts/yap-machine kit v2        # chapters, transcript and thumbnail picks
```

Pass `-p /path/to/project` when running outside a project folder.

`uv run python evals/run.py --solution` checks the whole engine against a synthetic take with a known right
answer; `--agent claude` runs a real agent against it ([evals/README.md](evals/README.md)).

## Updating

Stop the desk, update your checkout from GitHub, rerun `./scripts/install`, then
restart the desk and your agent. With an unchanged checkout, `git pull --ff-only`
updates the source. Preserve any local code changes before updating. Projects in
your workspace are separate from the application and are not replaced by installation.

## Privacy

Yap Machine processes footage and transcribes locally. Your editing agent may send
the text, images or files it reads to its provider under that agent's settings.
Installing dependencies and speech models uses network downloads. Keep personal
footage and project folders outside this repository and off public file shares.

## Licence

Yap Machine code is MIT licensed. Bundled components, fonts and the Remotion
renderer have their own terms; see [NOTICE](NOTICE) for licences and credits.
