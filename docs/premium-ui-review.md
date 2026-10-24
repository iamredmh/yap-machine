# Yap Machine — visual design revision

23 October 2026. This revision addresses the feedback about the native timeline slider, undersized effect labels, unnecessary timeline scrolling and the gap to the supplied reference products.

## What informed the revision

- [NN/g: visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/) and [visual design principles](https://www.nngroup.com/articles/principles-visual-design/) — use scale, spacing, restrained contrast and grouping to establish a clear reading order. Applied as a large video canvas, one clear export action, grouped transport controls and quieter secondary information.
- [WCAG 2.2: target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) — the AA minimum is 24 × 24 CSS pixels, with specified exceptions. Main transport actions are 36–40px, export is 42px, and effect timing rows are at least 44px high. Each entire effect row is clickable, so even a very short effect has an accessible-sized alternative to its proportional bar.
- [WCAG 2.2: contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) — ordinary text requires 4.5:1. The editor's primary text on white measures 15.24:1, secondary text 7.02:1, and muted text 5.68:1. Muted text on the canvas background measures 5.10:1. These are palette checks, not a claim that every part of the product has completed a WCAG conformance audit.
- [Style Studio](https://videoeditskill.synteq.app/) — inspected the live scene previews, font choices, collapsible customisation sections and comparison control. Its most useful design lesson is to show what a choice does, on relevant content.
- [Yap Studio](https://yapstudio.app/) — inspected the public page corresponding to the supplied screenshot. Its clear workflow, footage-based preset thumbnails, typography and spacing informed this revision. This is a public, waitlist-stage presentation, not an authenticated product benchmark.

## Implemented

The editor has a coordinated light palette, restrained sage accents, consistent stroke icons, larger controls and an editorial heading treatment. The video remains the primary work surface. Playback controls sit outside the image, so controls no longer cover the video or duplicate a second native scrubber.

The timing control has a visible ruler, a precise playhead and keyboard seeking. Effect names and durations occupy a dedicated column, independent of effect length. The previous 19px strips and 44px scrolling container are gone. Up to three 44px rows appear together; longer lists have explicit previous/next pages, and selecting an effect reveals its page. There is no vertical scrollbar in the timing region.

On screens shorter than 900px, effect rows are initially collapsed to preserve video space. The ruler remains available, and “Show timing” opens the rows. Larger desktop screens show the rows by default. Focus mode keeps the transport and ruler. Mobile moves undo/redo into the tool footer and keeps the video visible while the inspector scrolls.

The six style cards now show the cut's own footage and words through the same Remotion compositor used by the live preview and export. They are paused preset samples at 1.2 seconds, without added effects; the main preview shows the user's current edits. The previous decorative CSS placeholders were removed. Clicking the selected style preserves customisation instead of resetting its accent. Fine-tuning is grouped in an expandable section.

Playback waits until the live player is ready. Style changes preserve playback state. Rendered files use their actual duration and seek within the rendered video; returning to live preview is explicit. Existing save, draft recovery, comparison, undo/redo, effects and export behavior is retained.

## Verification

- Desk regression suite: **183 tests across 20 files passed**, including coverage for paged effect access and recovery after deleting the last row of a page.
- Desk and renderer TypeScript checks passed; production bundles built successfully.
- Browser checks at 1280 × 720, 1440 × 900, 1920 × 1080 and 390 × 844: style switching, original comparison, undo, playback, mute, precise keyboard seeking, effect search, four-effect pagination and focus mode.
- Two visible effect rows occupy 92px including their gap, with identical client and scroll heights. Three rows occupy 140px, also without overflow. Every row's bounding box is at least 44px high.
- Mobile document width matches its 390px viewport. The video remains visible while changing presets; focus mode expands it to approximately 535px high.
- A fresh 8-second export from the supplied reference excerpt completed. FFprobe reported **8.000s video and 8.000s audio**. The exported file was scrubbed to its last frame through the new controls and then returned to live editing.
- Palette contrast was calculated from the actual CSS colours.
- The browser automation logged transient `MutationObserver.observe` errors during rapid iframe reloads, without a source URL. No broken preview or control was reproduced during the interaction checks; these logs are not counted as a clean-console certification.

The local “Reference clip · UI study” project uses an eight-second excerpt of the user's supplied video for visual checks. It retains that clip's existing burned-in text. Its transcript timing is approximate for the interface fixture; it is not a transcription-quality benchmark. The original synthetic test project remains available separately.

## Comparison and limits

| Area | This revision | Reference comparison |
| --- | --- | --- |
| Choosing a style | Six actual preset previews on the current footage, plus Original | Applies the visual feedback principle seen in both references |
| Video workspace | Dedicated canvas, external controls, focus mode | Makes the video and its immediate changes the centre of the task |
| Timing effects | Readable selectable rows, accurate proportional bars, no nested scrollbar | Offers direct timing when needed without forcing an always-expanded timeline |
| Refinement | Accent, motion, per-effect content and timing | Style Studio still exposes deeper font, caption and layout customisation |
| Complete workflow | Existing footage → review → style → export flow | Yap Studio's public page describes an agent-first workflow; no unsupported superiority claim is made |

This revision raises the visual and interaction quality of the finishing workspace. It does not establish absolute feature parity or superiority over the references, and it does not replace usability testing with creators using their own footage.
