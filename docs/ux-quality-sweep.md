# Yap Machine — UX quality sweep

Historical review: the six-style counts below describe the 23 October build.
The current picker has six unified Yap Machine looks, with earlier saved
recipes retained. See [the treatment reference](brand-nat.md) for later changes.

23 October 2026. Implemented in the existing local project.

## Reference comparison

Reviewed the live [Style Studio](https://videoeditskill.synteq.app/) interface
and the previously transcribed 20-effect video supplied by the user. The
Style Studio page provides sample scenes, an example reel, detailed style
controls, undo/redo, comparison and a downloadable skill. It makes its preview
and customization controls the main workspace.

Yap Machine previously placed repeated page headings and seven large style
cards above the preview. At 1280 × 720, only the beginning of the video appeared
at the bottom of the initial screen. The effects library took more horizontal
space than the video area, and adding an effect used an independent time field
rather than the actual playback position.

| Area | Implemented in this sweep | Comparison and remaining scope |
|---|---|---|
| Preview priority | Persistent video stage, full portrait visible on a laptop, independently scrolling tools, Focus mode | Matches the reference's persistent preview principle, on the user's own cut |
| Navigation | Footage → Review → Style & export, with setup moved out of the main sequence | Makes the complete editing path explicit |
| Footage entry | Drag/drop or file picker, up to 30 files / 500 MB; folder import remains for large shoots | Brings source footage into the same product as styling and export |
| Trying looks | Six styles + Original, live updates, original comparison, undo/redo, keyboard commands | Removes the need to save/render to compare looks |
| Effect placement | Playback-linked playhead, clickable timed effect strips, transcript placement, nearest-cut placement for Zoom through cut | Applies the 20 reference effects within an actual editable cut |
| Effect discovery | Search, category filters, content/media requirements, inline readiness feedback | Avoids adding an effect that silently disappears for lack of input |
| Safe editing | Coalesced text history, undoable reset, draft recovery on unchanged cut/revision, asynchronous upload/save guards | Protects unfinished work while trying alternatives |
| Export | Persistent action, full-video summary, optional short render, separate previous-export status, download | Produces an MP4 from the same editor; export state includes timeline revision |
| Small screens | Persistent preview above independently scrolling tools; compact playback controls | Verified at 390 × 844 with no horizontal overflow |
| Preparation recovery | Retry without reupload; diagnostic logs behind details; short-speech crash fixed | A short/non-speech clip can finish preparation |

Style Studio still has deeper per-style typography, background, caption, card
and layout customization. Yap currently offers six bundled styles, accent and
motion controls. The video reference's cinematic effects remain the implemented
2D/compositing equivalents documented in the original build report. This sweep
does not establish superiority in output quality, render speed or user task
completion time; that would require representative footage and comparative
user testing. The concrete improvement is a connected workflow with editable
footage, real live previews, timed effects and an MP4 export in one product.

Footage preparation transcribes and organizes sources. The existing editing
agent still creates the first cut. Caption/name/spelling requests remain clearly
marked as agent changes, while style and effect changes preview directly.

## Verification

- 181 desk tests across 19 files pass, including history branching, typing undo,
  draft compatibility, missing effect content, local file confinement, duplicate
  filenames and import cleanup. Local-only import/retry routes are covered by
  the phone-access rule checks.
- 81 Python tests pass, including the new short-speech preparation regression.
- Desk and renderer TypeScript checks pass; both production web bundles build.
- Browser checks: live styles, original comparison, undo from the preview iframe,
  search, exact zero-time seek, incomplete-effect validation, live checklist text,
  draft recovery after refresh, mobile style selection with the video visible,
  full export and completed-download state. No browser error logs in the final check.
- A real local synthetic clip was imported through the file picker. Its first
  preparation exposed a delivery-report crash when no phrase had enough words
  for a pace measurement. Fixed and regression-tested; a new import and a retry
  of the existing project both completed successfully.
- Full exported video and audio are both exactly 8.000 seconds (ffprobe).
- Synthetic QA imports are archived outside the active workspace after testing.

## Use the updated editor

Open http://127.0.0.1:4690/#look and refresh once if an older page is open.
Run the commands below from the Yap Machine repository root.
`./scripts/start-desk <workspace>` starts the local app. The refreshed source ZIP
and wheel accompany the report in the task outputs directory.
