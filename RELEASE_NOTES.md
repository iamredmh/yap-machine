# Release notes

## 2026-10-26 — unified looks and steadier person cutouts

The picker now presents six Yap Machine looks: Clean, Editorial, Bold,
Handwritten, Glass and Terminal. Clean, Editorial, Bold and Handwritten provide
caption, title, layout, finish and emphasis controls. Warmth is a finish choice.
Checklist and Zoom each have two modes, reducing the picker to 20 effect choices
while preserving all 22 stored variants. Existing style recipes remain valid;
selecting a new look is a separate action from opening an old cut.

The user-supplied design reference informed the new treatments. Its original
codes are retained only as internal compatibility keys and in the
[support reference](docs/brand-nat.md), which distinguishes available behavior
from recipes requiring assets or new implementation. H1 and G6 require local
macOS person masks. Full notices accompany the two added OFL fonts.

Person cutouts now use accurate Vision segmentation at the video's full frame
rate, with a versioned, validated cache. Text behind the speaker uses one video
layer, and live playback waits for the current and next masks to decode before
advancing. This removes the old 15fps mask holds and duplicate-video drift.

Validation for this update: 157 engine tests and 315 editor/renderer tests pass,
both TypeScript checks pass, and the production editor builds. A 132-frame moving
fixture was rendered with the old and new pipelines: the new version has one mask
per frame, no missing settled headline, and no whole-frame alpha flash in the
frame comparison. Browser checks covered saved emphasis, effect modes, replay
and seeking. These short-clip checks do not guarantee perfect segmentation on
all footage. The QA figures in the entry below describe the earlier baseline.

## 2026-10-26 — source-install update

Install or update from this GitHub checkout using `./scripts/install`, then open
`./scripts/start-desk`. No npm or PyPI release is required. Existing projects stay
in the selected workspace; preserve local code changes before updating the checkout.

The editor now carries footage through **Footage → Review → Style & export**.
It includes six Style Studio packs, 22 timed effects, live preview, image/video
assets, saved visual settings and separate styled MP4 exports. The agent still
chooses takes and writes the edit; preparing footage does not create a first cut.

This update also includes:

- Text behind the speaker, with editable headline size and vertical position,
  plus an animated count-up or count-down effect with start and end values.
- Replacement backgrounds that accept uploaded images or videos; video
  backgrounds loop silently under the cut's audio in preview and export.
- Review batch recovery: an interrupted agent can explicitly resume its existing
  batch, without ordinary polling delivering active work twice.
- Upload confinement that rejects path traversal and upload-directory symlink
  escapes, and replaces uploaded files without following destination symlinks.
- Separate-microphone sync that keeps a strong recorded-audio match when visual
  motion suggests a conflicting offset.
- Quality checks that compare picture and sound using the actual render timing
  and framing. Deliberately shifted audio/video still fail the regression checks.
- Portrait face detection without stretching the source, consistent face-aware
  caption placement, and caption rendering fixes across preview and export.

### Verification and limits

The macOS QA pass completed **378 automated tests**: 119 Python tests and 259
Desk/renderer tests. Both TypeScript checks and the Desk build passed. It also
produced **43 exported videos** across styles, effects and workflow checks.
Actual local tests covered import, transcription, cuts, captions, microphone/screen
sync, review notes and recovery, asset upload, saving settings and media downloads.

The unmodified synthetic reference evaluation stopped when the local Whisper
base model transcribed “save a cup” as “savor cup”. A separate project with that
transcript corrected passed all 19 downstream reference checks. That corrected
run is not evidence of error-free transcription. Review the words and QC warnings.

Automatic person cutouts — including text behind the speaker, replacement
backgrounds and paper cutouts — require **macOS 12+ and Apple Command Line Tools**.
They run locally; hair, blur and overlapping people can affect mask quality.
Other styles and effects target macOS and Linux, but the full export pass above
was run on macOS. WSL2, independent-device clock drift on long recordings and
live sessions with every supported agent were not validated by this QA pass.
Translated-caption export was tested with supplied text; automatic translation
is the editing agent's job.
