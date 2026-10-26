# Yap Machine desk

The local web page where you review what your agent cut: watch each version with the
transcript beside it, see why each take was chosen, leave notes on the timeline, chat
with your agent, attach B-roll, set the look, and send it all back in one go.

Install from the [GitHub source checkout](../README.md), then run these commands
from the repository root:

```bash
./scripts/install --agent=claude-code # install and connect this agent
./scripts/start-desk                  # open the local desk
./scripts/yap-machine doctor          # check the engine's local tools
```

Agent choices are `claude-code`, `codex`, `cursor`, `gemini` and `claude-desktop`.
Omit `--agent` to install without editing agent configuration. The selected agent
also needs local terminal and file access to edit a video. The connection provides
the desk's review tools and uses this checkout, so keep it in place.

To preview a connection change after installation:

```bash
node desk/dist/cli/index.js setup --local --only=claude-code --dry-run
```

Restart your agent session after connecting. `yap_open` can then open the desk for
you. The desk runs in the background. `node desk/dist/cli/index.js stop` stops it;
add `--home /path/to/workspace` if you selected a custom workspace.
See the root README for dependencies, updates and platform support.

Projects live in a workspace folder (`$YAP_HOME`, default `~/Yap`). The desk reads each
project's files (cuts, checks and renders). Notes, chat, batches, browser imports and
review caches live in `<workspace>/.yap-desk/`. Uploaded effect assets, look changes
and saved visual settings live inside the selected project; preparation and export
write derived files there too. Originals imported by folder stay in that folder.

On Review the timeline shows the sound as a waveform (it needs `ffmpeg`, which the engine
already uses) and the keyboard works: Space or K play, J and L go back and forward at 1x, 2x
and 4x, the arrow keys step a frame (Shift: ten), `[` and `]` jump between notes and joins to
look at, C writes a note, M mutes, F is full screen, and ? lists them all.

Under the video is a control bar: frame steps, play, a speed from 0.25x to 2x (Space plays at it,
and it's remembered; `<` and `>` change it), and a loop. Loop repeats the whole cut, or a range:
press I and O (or the In and Out buttons) to mark its start and end, drag the handles on the
timeline to adjust, X clears it, R turns looping on and off. The waveform is
cached in `.yap-desk/peaks/`, keyed by each render's size and modified time.

The timeline zooms, to about two seconds across (a frame is tens of pixels wide, a word and the
pause after it are easy to tell apart), which is how you place a loop edge or a note exactly on an
hour-long cut. Use the + and - buttons or keys (0 shows the whole cut), pinch, or hold Ctrl and
scroll; scroll sideways or use two fingers to move. The strip above the ruler is the whole cut with
the part you're looking at outlined: drag the outline to scroll, drag its ends to zoom, click to go
somewhere else. While it plays the view follows the playhead. Zoomed in, the waveform is drawn from
finer detail the desk makes on demand, a few seconds at a time, and keeps in
`.yap-desk/peaks/tiles/` under the same size-and-time key (older renders' detail is removed).

### A note's life

A note waits until you press Send, then sits with your agent. When the agent says it fixed it (in
v5, say), the note shows "Fixed in v5: check it", and it appears in v5 at the same words, even though
you left it on v4. Check it, then **Resolve** it, or press **Not fixed** to send it back: the agent
gets it again marked NOT FIXED, with its last reply, so it tries something else. The Notes tab
filters by state (waiting, with your agent, to check, resolved); N and Shift+N step through the
notes you're showing. Resolved notes leave the list under the video.

### Compare versions

Press **Compare** (or V) on Review to play the version you're on beside an older one. The two
videos play together and are kept on the *same words*, not the same clock: each segment of a cut
remembers which stretch of your raw footage it came from, so when v5 has a line v4 doesn't, v4
waits ("Not in v4"), and when a line was cut, v5 carries on without it. Choose which video you hear
(H switches). A strip under the video shows what v5 added (green) and what was cut from v4 (red);
the panel on the left lists each change, small trims of a cut edge, and where the notes you left on
the older version went ("In v5 it is at 0:41", or "that part is not in v5").

### Review on your phone

Press **Phone** in the desk's top bar (or run `node desk/dist/cli/index.js phone`, or start the desk with
`serve --lan`) and scan the QR code with your phone's camera. Your phone and computer need to be on
the same Wi-Fi. You can watch the cut, tap or drag the timeline, leave notes and press Send.

How it stays safe: the desk always listens on `127.0.0.1`. Phone access opens a *second* listener on
your local network, only while you've turned it on, and every request to it needs the random code in
the link (it becomes a cookie on first use; a new code is made each time you turn it on). A phone can't
bring in a folder, stop the desk, run the engine, or act as the agent. Nothing is saved to disk:
stopping the desk, or `node desk/dist/cli/index.js phone off`, ends it. The link is plain http, so use home or
trusted Wi-Fi. If your Mac asks whether `node` may accept incoming connections, choose Allow.

Agent tools: `yap_open`, `yap_new_project`, `yap_status`, `yap_next_batch`, `yap_resume_batch`, `yap_reply`.

If an agent disconnects after picking up notes, `yap_status` exposes the unfinished
batch in `pickedBatches`. Once that session has stopped, the agent can call
`yap_resume_batch` with the same batch ID, inspect the existing cuts and replies,
and continue. Recovery preserves note IDs and previous replies. It does not
requeue active work; normal polling only picks up waiting batches, and completed
batches cannot be resumed.

The desk uses a light theme. Built on the Rushes core (see [NOTICE](NOTICE)).
