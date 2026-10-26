---
name: yap-machine
description: Cut talking-to-camera footage into a finished edit with Yap Machine. Use when the user points at a folder of raw to-camera recordings (vlogs, updates, script reads, rambles with retakes) and wants a cut that makes sense — best take of every line, no false starts, dead air or set-up chatter.
---

## The desk (where the person reviews)

The person watches your cuts, leaves notes and chats with you in the Yap Machine
desk, a local page in their browser. Use it:

1. `yap_open` once at the start: it starts the desk and opens it. Projects live
   in the workspace folder it reports; make new ones with `yap_new_project`
   (or `yap-machine init <workspace>/<name> --footage …` yourself).
2. After every version you make: `yap_reply` with what changed and where
   (timecodes), and the version name. Never overwrite a version they've seen.
3. To hear back: `yap_next_batch` (pass `wait_seconds`, e.g. 300, to wait while
   they review). A batch holds notes pinned to timecodes, chat messages, files
   they attached, and look changes (already written to style.json / people.json:
   re-render to apply). Answer every note by id in `yap_reply`.
   Name the version a fix landed in (`version`): the person checks each fixed note
   there and resolves it, or sends it back. A sent-back note arrives marked
   NOT FIXED with your last reply under it: try something different, and say what.
   After a disconnect, check `yap_status` for `pickedBatches`. Once the previous
   agent session has stopped, use `yap_resume_batch` with that batch's ID. It
   returns the same notes and their current replies without requeueing them.
   Inspect existing versions before continuing, preserve completed work, and
   answer with the same batch ID. Do not resume a batch another session is handling.
4. The person sees your `yap-machine cut` checks in Review → Checks, and on each short's
   card in Shorts, including every join the re-listen flagged, each with its
   picture and a "Note this" button. Fix the flagged ones before you reply, so
   they only see the ones you judged fine. They can leave notes on shorts too;
   those arrive with the short's version (see Shorts below).


# Yap Machine — you are the editor

Yap Machine does the mechanical work (sync, transcription, timing, rendering,
checks). **You** make the editorial calls: which attempt of each line to keep,
in what order, and what to leave out. You do that by writing one JSON file.

## Local source installation

Follow `llms.txt` in the GitHub checkout to install. The source installer creates
the local engine and desk; it does not install a global `yap-machine` executable.
In the command examples below, replace `yap-machine` with the absolute path to
`<checkout>/scripts/yap-machine`. Use that wrapper from any working directory.
If an installed copy of this skill includes a local runtime section, use the
checkout and engine paths recorded there. Keep projects outside the checkout. The default
desk workspace is `~/Yap`; use the connected workspace instead when one is configured.

The agent needs local file and terminal access to edit. Video processing and
transcription run locally; files the agent reads may be sent to its provider
under the agent's settings. Keep footage and transcripts out of public repositories.

## Workflow

1. **Set up** (once per footage folder). Keep the project off cloud-synced drives.
   ```bash
   yap-machine init ~/Yap/<name> --footage "<folder of raw footage>" [--exclude "test-footage/*"]
   yap-machine prep -p ~/Yap/<name>
   ```
   `prep` syncs a separate mic to the camera, transcribes locally (whisper.cpp),
   and writes `takes.md`.

2. **Read `takes.md` in full.** Every phrase the speaker said, numbered `P001…`,
   in recording order, with flags:
   - `retake→Pnnn` a later attempt at the same line follows closely. Usually keep the later one.
   - `≈Pnnn,…` every other attempt at the same line anywhere in the footage. Compare them.
   - `cutoff` a word breaks off mid-way: a false start, never keep it.
   - `filler` um/uh inside (they are removed automatically with `drop_fillers`).
   - `lowconf` Whisper was unsure of a word: often a mumble or mispronunciation.
   - `quiet` delivered noticeably quieter than usual: energy dropped, prefer a stronger take.
   Chatter between takes ("one more time", "that was terrible", countdowns) is
   never part of the edit.

   Then read `delivery.md`: *how* it was said, measured. Typical pace, pace per
   minute, filler rate, long pauses, and for every line said more than once a
   table comparing the attempts (pace against the speaker's typical, level,
   confidence). Use it to choose between attempts that read the same: the rushed
   one (far above typical pace), the one that trails off, the quiet one. It
   narrows the choice; it never overrules what the line says.

3. **Write `cuts/v1/edl.json`** (see format below). Then:
   ```bash
   yap-machine cut v1 -p ~/Yap/<name>        # resolve + render + check
   ```
   Use `yap-machine render v1 --draft` for a fast 540p look while iterating.

4. **Review your own cut before showing anyone.**
   - Read `cuts/v1/script.md`: the cut as text. Does it make sense start to
     finish? Any line said twice, any missing word, any sentence left hanging?
   - Read `cuts/v1/qc.md`. Errors must be fixed. Weigh every warning.
   - Read `cuts/v1/joins.md`. `yap-machine cut` re-listens to the *render* with Whisper
     at every join: is the last word before the cut and the first after it
     still whole (`clipped`/`missing`), is a word heard on both sides of a cut,
     is an *extra* word heard at it that the script doesn't have (a sliver of a
     neighbouring word left in the join), does the room sound or level change at it. Each join has a picture,
     `cuts/v1/joins/join-NN.png`: six frames across the cut, the waveform, and
     the words the cut meant against the words heard. **Look at the pictures of
     the flagged joins.** Whisper mishears, so a flag means look, not wrong. If
     a word really is clipped, move the cut (`start_at`/`end_after`, or another
     take) and re-check with `yap-machine joins v2` (`yap-machine check --fast` skips the re-listen).
   - **Edges are settled for you.** When loud sound runs across a cut edge and the
     transcript has no words for it (Whisper dropped a repeated phrase, or placed a
     word 0.1–0.5 s off), `yap-machine resolve` moves the edge out to the quiet beyond the
     sound and says so in `qc.md` ("Edge settled: …"). A short stretch is taken to be
     the edge word's own onset or tail; a longer one must sound like speech, and
     sound close to the neighbouring word is never taken in. Turn it off with
     `"settle_edges": false` in the EDL. If a warning that a cut **starts or ends
     inside speech** is still there, the engine judged the sound not to be speech
     or too close to the next or previous word; listen to the source at the times
     given and fix with raw times (`{"source": "…", "start": 259.28, "end": 267.92}`)
     or another take. Captions still follow the transcript, so words it dropped have
     no caption.
   - Frames around the cut are in those sheets; for a cut that isn't flagged
     but you doubt, `yap-machine joins` draws them anyway.
   - Fix by writing `cuts/v2/edl.json` (copy v1, change it, say why in `why`).
     Never overwrite a version that has been shown to the user.

5. **Hand over**: render path, length, one line per editorial choice the user
   might disagree with (which take, what you dropped).

## Matching a video the person likes

If they say "make it feel like this one", measure it instead of guessing:

```bash
yap-machine reference ~/Movies/their-favourite.mp4 --against v1 -p ~/Yap/<name>
```

`references/<name>.md` says how the reference cuts (cuts a minute, typical shot),
how fast and tight the speaking is (pace, gap between phrases), how loud it is,
how the speaker is framed, and, with Tesseract installed, how its captions look
(words at a time, how far down, how big, colour, highlight). `--against` puts your
cut beside it in `cuts/v1/vs-<name>.md`, with a JSON block of settings
(`max_pause`, caption `max_words`/`y`/`size`/`color`/`active`) that would move your
cut towards it. Cut detection and caption reading are estimates; nothing from the
reference is used in the edit. Apply only what the brief asks for.

## Posting kit

```bash
yap-machine kit v2 -p ~/Yap/<name>     # → cuts/v2/kit/
```

`facts.md` lists the beats with timecodes; `transcript.txt` is the cut as timecoded
text; `thumbs/` holds the best still frames (face in shot, sharp, centred). Name
chapters in the EDL, `"chapters": [{"range": 0, "title": "…"}, …]` (or `{"at": 95, …}`),
3 or more, each 10s or longer, and `chapters.txt` is written in YouTube's format.
Then write the words yourself into `kit/post.md`: title options, a description that
includes the chapters, a three-line summary, hook variants from the cut's own
opening lines. Look at the thumbnail picks and choose one.

## Shorts (after the long cut is approved)

Shorts are cut **from an approved long cut**, never from raw footage, so
every fix the user made to the long cut carries over.

```bash
yap-machine shorts v2 -p ~/Yap/<name>        # writes cuts/v2/shorts.md: the long cut's ranges, lengths, openers
```

Write each short as `cuts/v2/shorts/s1/edl.json` (s2, s3, …):

```json
{
  "parent": "v2",
  "format": {"width": 1080, "height": 1920},
  "reframe": "face",
  "brief": "One sentence: the single point this short makes",
  "ranges": [ … same phrase-id ranges as the long cut … ]
}
```

Then `yap-machine cut v2.s1 -p ~/Yap/<name>` → `renders/v2.s1.mp4`.

- 30–90 seconds, **one point per short**. Open on the strongest line, not the
  long cut's warm-up. Reordering is fine if it still reads as one thought.
- End on a line that lands (a verdict, a payoff, a call to action), not on a
  dangling "so…".
- Only use material the long cut uses: QC warns if a range isn't in the parent.
- `reframe: "face"` crops every segment around the speaker's face (static per
  segment, headroom kept). QC checks the face is in shot in each segment.
- Notes on a short arrive with its version, e.g. `v2.s1 at 0:34`. Never overwrite
  a short the person has seen: make the fix as a new short, either under a newer
  long cut (`v4.s1` once `cuts/v4` exists) or under the same parent with the next
  number (`v2.s4`), then reply naming it.
- Lines that only make sense with the screen ("right here", "this button")
  are weak in a face-only short; prefer lines that stand on their own.

## Captions, lower thirds, translations

Set up once per project:

- `style.json`: `{"accent": "#F0412B", "spellings": {"acme": "ACME"}}`.
  The accent lights the spoken word in short captions and the bar on the name
  card. `spellings` fixes brand and name spellings in captions (and nudges
  Whisper towards them on the next `yap-machine prep`).
- `people.json`: `[{"id": "sam", "name": "Sam Rivera", "title": "Founder, Acme"}]`.

Then in any EDL (long cut or short):

```json
"captions": true,
"lower_thirds": [{"person": "sam", "at": "P017", "duration": 4.5}]
```

- Captions follow the words exactly as heard. Long form gets calm two-line
  sentence captions; vertical shorts get bold 2–3 word captions with the spoken
  word highlighted (`{"preset": "long" | "short"}` to override).
- `at` is seconds into the cut, or a phrase id (the name card lands when that
  phrase starts). Put it after the hook, when the viewer wants to know who's talking.
- Vertical shorts lay out around the face: captions go just under the chin,
  inside the phone-safe area; the name card goes between chin and captions, or
  top-left if there's no room. Punch-ins that would push the chin into the
  captions are skipped (QC notes it).
- Every render also writes `captions.srt` (for upload) and `translate.json`.

**Translating** (the agent does this — no API needed):

1. Read `cuts/<version>/translate.json`: whole sentences with times.
2. Write `cuts/<version>/captions.<lang>.json`: same items, same `start`/`end`,
   `text` translated. Keep product names as they are; translate meaning, not word order.
3. `yap-machine render <version> --lang <lang>` then `yap-machine check <version> --lang <lang>`
   → `renders/<version>.<lang>.mp4`, `captions.<lang>.srt`, `qc.<lang>.md`.

QC for overlays: captions fit their lines, never cover the face, never collide
with the name card; the name card stays in the safe area and off the face.

## Screen recordings

Put the screen capture in the footage folder. If it recorded the same voice,
`yap-machine prep` syncs it to the camera. On any range of a 16:9 cut:

```json
{"from": "P020", "to": "P023", "layout": "screen", "screen_crop": [0.3, 0.1, 0.5, 0.5]}
```

The screen fills the frame and the speaker drops into a rounded picture-in-picture.
`screen_crop` (optional, fractions of the screen recording) zooms into what is
being talked about. Use the screen whenever a line points at it ("right here",
"this button"); keep hooks and closes on camera.

`yap-machine focus v2` finds where to zoom: it watches each screen range's recording for
where things change (a menu opening, text arriving, the pointer moving), ignores page
changes, and writes `cuts/v2/focus.md` with a suggested `screen_crop` per range and the
times where the action moves to another part of the screen (a good place to split the
range). It sees activity, not meaning (a spinner moves too), so look at the area before
taking a suggestion.

## EDL format

```json
{
  "brief": "What this cut is for, one sentence",
  "format": {"width": 1920, "height": 1080},
  "max_pause": 0.5,
  "drop_fillers": true,
  "punch_in": 1.12,
  "ranges": [
    {"from": "P099", "quote": "This is the biggest update", "beat": "hook", "why": "final reset take, cleanest"},
    {"from": "P071", "to": "P073", "quote": "First up, agentic", "beat": "agentic"},
    {"from": "P044", "start_at": "Acme.com", "quote": "Second, we've got", "beat": "front of shop", "why": "only take that says 'the works'"},
    {"from": "P083", "end_after": "sign in.", "skip": ["P084"], "beat": "front of shop"}
  ]
}
```

- `from` / `to`: phrase ids from `takes.md`, same source; `to` defaults to `from`. Everything between is kept unless listed in `skip`.
- `quote`: the first few words of the `from` phrase. **Always include it**: if phrase ids shift after a re-transcribe, resolve refuses to cut instead of cutting the wrong line.
- `start_at` / `end_after`: trim inside the first / last phrase by quoting words exactly as in `takes.md`.
- `beat`: a short label for the section (shows in `script.md`).
- `why`: your reason, in plain words. The user reads these.
- `max_pause`: pauses between sentences longer than this are tightened (comma breaths up to 0.8s and mid-clause pauses up to 1s are left alone). `null` keeps every pause.
- `punch_in`: alternating zoom on jump cuts within one camera; `0` turns it off.
- Raw times are possible (`{"source": "C0017", "start": 312.4, "end": 318.0}`) but phrase ids are safer.

## Editorial rules of thumb

- **One clean attempt per line.** When a line was read several times, prefer
  the take without `lowconf`/`quiet`/`cutoff`, then the later one (speakers
  warm up), then the one that keeps you in the same pass as its neighbours
  (fewer jump cuts).
- **Stay in one pass when you can.** Switching passes is fine on a locked-off
  camera (the punch-in hides it) but every switch is a join.
- **Words the speaker ad-libbed** that the script didn't have: keep them if
  they sound natural, drop them (with `end_after` / another take) if they pad.
- **Long form (16:9)** keeps the whole argument. Shorts are cut later from an
  approved long form, not from raw footage.
- If no clean take of a line exists, say so in your hand-over rather than
  hiding it.

## Styles and timed effects

Once the cut is resolved, save `visuals.json` beside its EDL. In the desk,
**Style & export** offers six Style Studio packs and 22 timed effects. The editor
can choose an accent and motion strength, place effects on transcript lines,
add text/items/real chart values or supporting assets, save, preview and export.

```sh
yap-machine visuals-catalog
yap-machine visuals v1 -p ~/Yap/my-video --preview --at 4
yap-machine visuals v1 -p ~/Yap/my-video
```

Read `studio/README.md` in the source checkout for the complete settings format
and requirements. Use `preset` original/volt/ledger/sketch/terminal/glass/pop,
`motion` subtle/balanced/bold, and an `effects` array. Each effect has a unique
`id`, catalog `type`, output `at` in seconds, `duration` and `strength` (0.25–2).
An optional source `anchor: {source, time, occurrence}` takes precedence and
keeps the moment attached to the footage through edits. Removed footage must
be placed again. CLI `at` may also be a phrase id. Durations must fit the cut;
zoom-through-cut must span an edit boundary.

Text belongs to the creator: never fabricate statistics, quotes or chart
values to fill a design. Upload required image/video assets inside the project
and reference their relative path. Checklists/headlines use `items`; charts
use at least two real `values`. Cutout effects need macOS Vision and Apple's
command-line tools; the desk marks them unavailable on other platforms. The full
template layouts target 9:16 portrait. All rendering stays on this computer.

Two direct templates work on the creator's original video:

- **Words behind you** (`text-behind-person`) layers the original video, a
  headline, and an automatically masked copy of the presenter. The room stays
  visible. Supply nonempty `text`; optional `textSize` is a fraction of the
  short canvas side (0.06–0.30, default 0.16) and `textY` is a fraction down the
  picture (0.10–0.85, default 0.30). Captions remain above the finished picture.
  Choose a short phrase from the creator's words and check the face/shoulder
  overlap in a rendered preview. No external background asset is needed.
- **Count up** (`count-up`) uses exactly two finite `values`: `[start, end]`,
  each between −1 trillion and 1 trillion. `text` is an optional descriptive
  label. Numbers can be fractional, negative or descending; the animation
  reaches the exact total before it exits. The editor asks for both numbers
  instead of inventing a statistic. Use only creator-provided figures.

For example, after the creator has supplied the headline and total, an effect
can use `{"id":"headline","type":"text-behind-person","at":1,"duration":3,
"strength":1,"text":"Your approved headline","textSize":0.18,"textY":0.28}`.
A count uses the same timing fields with `"type":"count-up"`, the supplied
`"values":[start,end]`, and its label in `text`. Put the count after the headline
in the effects array to show its card above the presenter. Check that both fit
the cut. Preview and MP4 export share the same composition and timing.

Styled previews/exports are separate MP4s. Inspect the result for caption
readability, foreground edges and timing. Save the six-second preview first
when trying a new effect, then render the final video. Keep the original EDL
and source footage editable.
