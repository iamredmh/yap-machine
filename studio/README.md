# Yap Machine styles renderer

This adapter runs the six Style Studio packs on Yap Machine's resolved cut and
word timings, then composites timed effects. Footage, audio and person masks
stay local. The desk is still the existing Yap Machine desk.

From the repository root, `./scripts/start-desk ~/Yap` installs the locked
engine and Node dependencies, builds the desk and serves that workspace.
Alternatively run `npm ci --prefix studio` once, alongside the usual engine
and desk installation. Styles need Node 22.12+, FFmpeg and a Chromium executable
(Google Chrome is detected on macOS). Set `YAP_BROWSER` to another Chromium
executable when needed. Rendering uses an isolated headless browser profile;
a browser extension is not needed for video rendering.

Cutout effects use macOS Vision and Apple's command-line tools (`swiftc`).
They cache grayscale masks under the project's `cache/person-masks/` directory.
Styles and effects that do not require cutouts can also run on other systems.
When FFmpeg has no libass, the compositor also draws the original captions.
Yap Machine reuses an available local Whisper model, including Elgato VoiceSync
models, and can fall back to CPU when Metal is unavailable.
The native cutout renderer has been verified on this Mac; edge quality depends
on the input. Dolly zoom is a foreground/background simulation. Studio reveal
and orbit use animated graphics rather than generated 3D footage.

## Commands

```sh
yap-machine visuals-catalog
yap-machine visuals v1 -p ~/Yap/my-video --preview --at 4
yap-machine visuals v1 -p ~/Yap/my-video
```

The Style & export workspace keeps the video visible beside independently scrolling
tools. It includes undo/redo (Cmd/Ctrl Z and Shift Z), save (Cmd/Ctrl S), an original
comparison, an effects timeline, search and per-effect input guidance. Unfinished
drafts recover in the same browser when the saved revision and cut are unchanged.

The desk opens a live preview by default. Choosing another style changes the
composition immediately, without saving or rendering a clip first. Text,
checklist, timing and effect edits also update the live composition. The
uncaptioned cut is prepared once and reused by every style; the player uses
the same components as the export renderer and retains its playhead across
style changes. Presenter cutouts are prepared locally when needed.

“Rendered video” switches to the last exported file. Editing a look switches
back to the live composition. A render that finishes after a newer edit does
not replace that newer live look. The desk also reopens completed exports and
reconnects to an in-progress render.

Preview renders up to six seconds from the selected output time at 540p.
Export renders the whole cut at its timeline resolution. Both are separate
files (`renders/v1-styled-preview.mp4`, `renders/v1-styled.mp4`). Normal
`render` and `cut` commands also honor saved visual settings.

The full Style Studio layouts target portrait 9:16 video. Wide cuts use the
pack's fonts, accents and styled captions; effects support both aspect ratios.
Saved EDL captions and name cards remain available. Styling follows actual
words from the cut. Checklist items, headlines and chart values are supplied
by the creator; they are never fabricated to fill a template.

## Saved settings

Each cut has `visuals.json` beside `edl.json` and `timeline.json`:

```json
{
  "schema": 1,
  "rev": 1,
  "preset": "volt",
  "accent": "#FFE600",
  "motion": "balanced",
  "effects": [
    {
      "id": "key-point",
      "type": "snap-zoom",
      "at": 4,
      "anchor": {"source": "camera", "time": 17.2, "occurrence": 0},
      "duration": 1.5,
      "strength": 1,
      "enabled": true
    }
  ]
}
```

`at` is output time in seconds. An optional source `anchor` takes priority and
is resolved again after editing. If its footage is removed, the effect is
flagged for placement instead of drifting onto unrelated words. Repeated
source ranges use `occurrence`. CLI effects may also use a phrase id as `at`.

Additional fields: `text`, `items` (up to eight short lines), `values` (2–12
numbers for a growth curve), and `asset` (an image/video path inside the
project). The desk uploads effect assets to `uploads/`. Asset video loops
silently under the cut's audio. A zoom-through effect must span an actual cut.
Effects apply in the list's stacking order; they can overlap, be moved, disabled
or removed. Durations must stay inside the cut.

The desk saves with revision and timeline checks, snapshots settings for a
render, serializes renders per cut, and publishes a finished MP4 atomically.
An unsuccessful render leaves the previous playable export intact. Project
style defaults live in `style.json` as `visual_defaults` and do not copy timed
effects into unrelated cuts.

## Source and licenses

`src/engine`, `kit`, `scenes`, `pack-scenes`, `packs`, `reel` and `public/fonts`
are adapted from kelano86's [Style Studio engine](https://github.com/kelano86/style-studio-engine)
(commit recorded in the root NOTICE). Its MIT license is in
`STYLE-STUDIO-LICENSE`. Font notices are alongside each font. Our integration
is in `src/yap/`, `render.mjs`, `person-mask.swift` and `catalog.json`.

Remotion is a separate dependency with its own [license](https://www.remotion.dev/license),
retained in its installed npm packages. The Style Studio MIT license does not
replace dependency licenses.

## Verification

`npm run typecheck --prefix studio` checks the adapter and vendored templates.
`render.mjs` also accepts a JSON array of `{props, output, frame?}` jobs, with
an output directory as its second argument, for rendering a QA batch with one
bundle. Omitting `frame` produces a video; supplying it produces a PNG.
