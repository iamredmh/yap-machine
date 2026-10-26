# Preview composition regression checks

The October 26 preview fix addresses three distinct failures: the behind-person title could disappear for one browser frame, switching looks could briefly show a black video pane, and the behind-person effect replaced the selected look with raw footage.

## Rendering contracts

- Person masks use bounded, persistent SVG image definitions. Readiness comes from the image that paints the mask, and playback waits for the current and next mask. Fitted video panels supply their own mask canvas and crop geometry.
- Behind-person text is an overlay inside the selected look's footage. It follows that footage's crop and source time without replacing the look. A manual headline takes priority over an overlapping automatic opening heading.
- Effect timing changes visibility while preserving the mounted source video. Styled counters sit below the native caption lane. Full-picture effects deliberately take over the picture for their scheduled duration.
- Look changes, edits and seeks retain the last visible preview until the incoming document has loaded its fonts, video and masks. Revision checks reject stale style or seek acknowledgments. Only the current document plays audio.
- Playback holds the final frame. Pressing play again restarts intentionally.

## Verification performed

The regression fixture used the same two-second, 24 fps clip and native 48-frame mask sequence as the reported problem, with a behind-person headline and a counter.

1. Continuous Chrome Player playback: the previous mask implementation lost the title in 7 of 247 compositor captures; the replacement lost it in 0 of 300 captures over four loops. Both reported mask readiness throughout, demonstrating why readiness checks alone were insufficient. Normal cutouts and inset mask geometry were also checked visually.
2. Editor transport: rapid look changes while playing with audio, seeking during a pending look change, holding the last frame and replay all passed. A pixel check of 106 painted browser frames found no near-black video pane. A longer speech clip and a future full-screen effect also passed readiness checks. With an injected 850ms mask delay, a seek outside the mask cache kept the previous composition visible: hidden-mask samples dropped from 52 to 0, with no missing headline in the captured frames.
3. Export: all six picker looks rendered with and without the two effects, producing 12 videos. Every output decoded successfully as 48 frames at 24 fps, 540 × 960. Representative frames were compared with the style-only samples to check layout, captions and face clearance.
4. Automated checks: 363 editor/renderer tests and 157 engine tests passed, along with both TypeScript checks and the production build. Regression coverage includes mask readiness and geometry, preview handoff revisions, stable effect boundaries, caption ownership and presenter overlay coordinates.

These measurements cover the reported regression in local Chrome. They do not establish that all footage, effect combinations or browsers have been exhaustively tested.

## Style examples and optional speaker overlap

The headline-plus-counter combinations above are compatibility tests, not the
recommended treatment for every look. The follow-up gallery separates those
tests from six simpler examples: a behind-person title for Clean, captions for
Editorial, an optional speaker overlap for Bold, and the native title treatments
for Handwritten, Glass and Terminal. Short legacy headings now use each opening
word once instead of recycling words to fill empty title rows.

Speaker overlap is opt-in for L5/L6 top panels. It reveals one source video
through the union of the native person mask and the footage rectangle, so the
crown and the rest of the speaker cannot drift between independently playing
layers. Very close shots retain the ordinary fitted composition when an overlap
would cut off the face or expose an empty lower edge. The editor preserves the
setting through save, reload and undo, while retaining manually added effects.

A moving stock-footage test exposed inaccurate crown estimates from the face
rectangle alone. Overlap framing now uses a bounded sample of the native masks
near the detected face to estimate the visible hair edge. Ambiguous samples
fall back to the face estimate. This is a static framing measurement, not
face tracking; the extra measurement affects only the opt-in overlap layout.

Draft plates and visual plans now use the same aspect-preserving dimensions.
Square and 4:5 projects therefore use the same layout in preview and export.

## Repeat after preview changes

Run the engine and editor suites and both typechecks. Also inspect continuous browser playback: offline exports cannot expose a live CSS mask repaint or iframe handoff defect. Compare style-only and styled-with-effects output, then exercise rapid switching, seeking, end-of-playback and replay with audio enabled.
