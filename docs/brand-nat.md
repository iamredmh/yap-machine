# Yap Machine looks and treatment reference

Choose one of six looks in **Style & export**: Clean, Editorial, Bold,
Handwritten, Glass or Terminal. They belong to one Yap Machine catalog.
Warmth, caption treatment and layout are adjustments rather than separate
collections. The design reference supplied by the user informed the new
controls; its code names are kept here for traceability, not presented as the
product's vocabulary.

Clean, Editorial, Bold and Handwritten offer nine caption choices, six opening
titles plus Off, three layouts and seven finishes. Glass and Terminal keep
their distinct existing renderers. Checklist combines Card and Full-screen
modes, and Zoom combines Punch-in and Camera modes. The picker has 20 effect
choices while retaining all 22 stored variants.

The original reference describes 105 recipes. The tables below cover every code
and distinguish available treatments, approximations, media/editorial work and
unimplemented graphics. They do not describe 105 installed effects. The
third-party guide's original code, full prose and sketches are not distributed.

## Choices and saved-cut compatibility

| Picker name | Stored preset ID | Caption | Opening title | Layout | Finish |
|---|---|---|---|---|---|
| Clean | `nat-clean` | C5 | H5 | L4 | G4 |
| Editorial | `nat-editorial` | C9 | H10 | L4 | G2 |
| Bold | `nat-bold` | C2 | H3 | L5 | G7 |
| Handwritten | `nat-scrapbook` | C1 | H8 | L5 | G3 |
| Glass | `glass` | Existing Glass treatment | Existing Glass scenes | Existing Glass layout | Existing Glass palette |
| Terminal | `terminal` | Existing Terminal treatment | Existing Terminal scenes | Existing Terminal layout | Existing Terminal palette |

The `nat-*` IDs and `brandNat` settings key are internal compatibility names.
Renaming the picker does not rewrite a saved cut's rendering recipe. The catalog
keeps older rows under `legacyStyles`; they are accepted for existing cuts but
do not create duplicate picker cards.

| Existing preset | Picker family | Saved rendering |
|---|---|---|
| `nat-clean` | Clean | Same preset and treatment settings |
| `nat-editorial` | Editorial | Same preset and treatment settings |
| `nat-warm` | Editorial, warm finish | Original Warm recipe retained; not replaced by Editorial defaults |
| `nat-bold` | Bold | Same preset and treatment settings |
| `nat-scrapbook` | Handwritten | Same preset and treatment settings |
| `volt` | Bold | Original Volt recipe retained |
| `ledger` | Editorial | Original Ledger recipe retained |
| `sketch` | Handwritten | Original Sketch recipe retained |
| `pop` | Bold | Original Pop recipe retained |
| `glass` | Glass | Same renderer and settings |
| `terminal` | Terminal | Same renderer and settings |

For effects, `checklist-pop` remains Card and `checklist` remains Full screen;
`snap-zoom` remains Punch in and `digital-zoom` remains Camera. The UI mode
selects those existing types. Preserve each effect's id, timing, anchor, text,
values, assets, enabled state and order. Zoom circle (`zoom-portal`) is a moving
circular copy, whereas Zoom transition (`zoom-through-cut`) bridges a real cut;
they are not aliases. Shatter (`frame-break`) and Pop-out frame (`frame-escape`)
also remain distinct.

## Treatment behavior

Opening titles occupy the first three seconds, or the whole cut when shorter.
Empty title and subtitle fields use the first four and next five actual opening
words. Prefer a short, meaningful heading over an arbitrary transcript fragment.
Use Title space when the original shot has too little clear headroom for a
readable title. A title should not be shrunk indefinitely to fit a close-up.

Captions follow transcript timing. Optional `emphasis` is a comma-separated
list of words to emphasize; matching words end a phrase so the selected word
gets its highlighted treatment. Blank or omitted emphasis preserves the
existing phrase grouping and last-word emphasis. It does not run semantic
keyword selection or invent words. Review how your chosen words break phrases.

`auto`, `top` and `bottom` are caption-placement preferences. Layout considers
the detected face and some known overlay regions, then fits the phrase into
available space. It does not understand every logo, product, hand or baked-in
caption. Small lanes can use a compact phrase treatment instead of the stepped
layout. Translated captions without word timings use complete timed phrases;
C2 and C9 fall back to C5 rather than inventing word timing. C3 disables added
captions, never text already in the source.

H1 places the opening title behind the speaker while that title is visible.
G6 grades the room separately from the person throughout the cut. Both require
a locally generated person mask, currently available on macOS 12+ with Apple
Command Line Tools. The Desk shows availability and explains missing tools.
Other choices require no mask unless another timed effect needs one. Review
hair, motion blur, overlapping people and foreground edges in the actual video.

## Saved settings and agent use

Save this shape in `cuts/<version>/visuals.json`, or use the desk's Save action.
Only the configurable `nat-*` recipe IDs accept `brandNat`, including retained
`nat-warm` cuts. Missing recipe fields use the catalog defaults. The
[renderer README](../studio/README.md) describes revision handling.

```json
{
  "schema": 1,
  "rev": 1,
  "preset": "nat-editorial",
  "motion": "balanced",
  "brandNat": {
    "caption": "C9",
    "hook": "H10",
    "layout": "L4",
    "finish": "G2",
    "title": "",
    "subtitle": "",
    "emphasis": "",
    "position": "auto"
  },
  "effects": []
}
```

`title` allows up to 120 characters, `subtitle` up to 100 and `emphasis` up to
160. Prefer short, readable wording. `hook: "none"` omits the title. The
[catalog](../studio/catalog.json) is the authority for values and defaults;
`styles` contains visible choices and `legacyStyles` retained recipes. Internal
render-plan fields such as `timelineOffset` do not belong in saved settings.

From the checkout, after resolving the cut:

```sh
./scripts/yap-machine visuals-catalog
./scripts/yap-machine visuals v1 -p ~/Yap/my-video --preview --at 0
./scripts/yap-machine visuals v1 -p ~/Yap/my-video
# Render a snapshot without changing the saved look:
./scripts/yap-machine visuals v1 -p ~/Yap/my-video --settings /absolute/path/to/settings.json
```

When a creator requests another source recipe code, consult its row. Explain
any proposed approximation and ask for necessary screenshots, logos, clips,
figures and source information. A reference to proof does not authorize
inventing proof. App/chat illustrations do not perform actions in those apps.

## All 105 recipe codes

**Native** means an editable Yap treatment is available. **Existing route**
means the current editor or agent can achieve the core idea, sometimes with
limitations stated in the row. **Media/edit** needs real source assets or an
editorial decision. **Not native** means the exact graphic or mix is not
implemented; any related tool is only a starting point.

### Hooks — 10

| Code | Idea | Current support and inputs |
|---|---|---|
| H1 | Title behind the presenter | **Native.** Outlined display title and italic secondary line; needs a person mask. |
| H2 | Branded comparison stickers | **Not native.** Needs official logo assets, brand names and a multi-sticker composition. |
| H3 | Warm uppercase opening | **Native.** Warm outlined display text with a secondary line; no dedicated per-letter typewriter or emoji picker. |
| H4 | Mixed serif/sans opening | **Native.** Italic secondary line above a bold lowercase title. |
| H5 | Brief title panel | **Native.** A light title box during the opening three seconds. |
| H6 | Open in the actual result | **Media/edit.** Select authentic footage recorded in that setting or outcome. |
| H7 | Question with brand logos | **Not native.** Needs question copy, official logos and logo cue timing. |
| H8 | Handwritten lead and bold title | **Native.** Handwritten secondary line and underline; not a fabricated comment screenshot. |
| H9 | Replace one brand with another | **Not native.** Needs two authorized logos and a timed strike-through treatment. |
| H10 | Two contrasting title weights | **Native.** Display and serif lines; uses bundled typefaces rather than an unavailable thin condensed face. |

### Captions — 9

| Code | Idea | Current support and inputs |
|---|---|---|
| C1 | Handwritten phrase emphasis | **Native.** Words reveal to speech; a phrase-ending word gets a warm highlight. |
| C2 | One emphatic word | **Native.** One large uppercase word follows the transcript. |
| C3 | No added captions | **Native.** Omits generated captions; baked-in source text remains. |
| C4 | Enlarge the key word | **Native.** The emphasized phrase-ending word is larger than surrounding words. |
| C5 | Light keyword pill | **Native.** A white pill highlights the final word of each phrase. |
| C6 | Phrase and punch line | **Native.** A small line leads to a larger warm final word. |
| C7 | Small caps and italic emphasis | **Native.** Tracked caps lead to a larger italic final word. |
| C8 | Compact uppercase captions | **Native.** Small caps in available face-safe space; no continuous chin tracking. |
| C9 | Stepped words | **Native.** Staggered word positions end with an italic, underlined word. |

### Layouts — 9

| Code | Idea | Current support and inputs |
|---|---|---|
| L1 | Cards in a layered room | **Not native.** Existing masks help, but arbitrary cards and a separately blurred room need another composition. |
| L2 | Presenter/proof split | **Not native.** Requires an exact top/bottom split and proof media; B-roll's small narrator inset is different. |
| L3 | Multi-card scrapbook | **Not native.** Supply media/stickers; a pastel finish alone does not create a collage. |
| L4 | Original shot with overlays | **Native.** Keeps the shot full frame, subject to the chosen finish's framing. |
| L5 | Story band above video | **Native.** Reserves an upper title band; no arbitrary photo or quote asset slots. |
| L6 | Upper writing space | **Native.** Frames the presenter below a light board area; not an interactive drawing tool. |
| L7 | Rotate layouts by idea | **Media/edit.** Plan section boundaries and content; automatic multi-layout rotation is not a control. |
| L8 | Polaroid narrator over a screen | **Not native.** The existing B-roll inset is rectangular, without a tilted photo frame. |
| L9 | Export two versions side by side | **Not native.** Requires two timed sources; Desk Compare is for review, not this export layout. |

### Proof — 7

The supplied catalog has no P5 entry.

| Code | Idea | Current support and inputs |
|---|---|---|
| P1 | Highlight a real article | **Not native.** Supply screenshot, quote region, source and date; needs a dedicated highlight card. |
| P2 | Show an official demo | **Media/edit.** Use permitted demo footage and attribution, with existing screen/media routes as suitable. |
| P3 | Large count behind a person | **Not native.** `count-up` is a foreground number card; behind-person numbers need additional masking/composition. |
| P4 | Show a real social post | **Not native.** Supply a genuine screenshot or verified content; custom post framing is not a built-in template. |
| P6 | Use personal archive material | **Media/edit.** Select real photos/clips and place them on relevant words; multi-card montages are separate work. |
| P7 | Demonstrate with a screen recording | **Media/edit.** Record real steps and cursor movement; use screen ranges or a supplied B-roll clip. |
| P8 | Film a screen result in person | **Media/edit.** Needs that recording; software cannot establish the event after the fact. |

### Visual beats — 23

| Code | Idea | Current support and inputs |
|---|---|---|
| V1 | Roles beside logo tiles | **Not native.** Supply logos and role labels; needs multi-tile timing. |
| V2 | Connect logos with arrows | **Not native.** Supply logos and real relationships; needs a diagram composition. |
| V3 | One large word | **Existing route.** A short headline can emphasize a word; exact floating typography may differ. |
| V4 | Swap brands rapidly | **Not native.** Requires multiple logos and a controlled swap sequence. |
| V5 | Compare products in rows | **Not native.** Supply names, current verified prices and audience labels. |
| V6 | Emphasize the payoff | **Existing route.** Use supplied headline text; a dedicated free-positioned payoff word is not a separate control. |
| V7 | Build a full-screen sentence | **Not native.** Existing text scenes are related; custom line/emoji cueing needs implementation. |
| V8 | Type a quotation | **Not native.** Needs approved quote, attribution and a timed quote-card treatment. |
| V9 | Personal-life montage | **Media/edit.** Select genuine clips and cut them to the narration. |
| V10 | Explain a sponsor flow | **Not native.** Supply approved flow labels; illustrated steps must not masquerade as real results. |
| V11 | Persistent section progress | **Not native.** Needs section names, boundaries and an ongoing progress component. |
| V12 | Glowing logo entrance | **Not native.** Supply a logo; bloom/glint and any sound need dedicated handling. |
| V13 | Circular numeric timer | **Not native.** A numeric counter exists, but it is not a ring widget. |
| V14 | Flip a calendar year | **Not native.** Needs year values and a calendar animation. |
| V15 | Phone notification banner | **Not native.** Needs approved copy and an app icon; label a recreation appropriately. |
| V16 | Toggle device controls | **Not native.** Needs labels, states and timings; these would be illustrations. |
| V17 | Gradient comment prompt | **Not native.** Needs CTA wording and the ring/typing component. |
| V18 | Travel-photo cards | **Not native.** Supply real photos; multi-card layout and shutter sound are separate work. |
| V19 | Profile/comment sequence | **Not native.** Needs approved account content; it would not actually post, follow or create engagement. |
| V20 | Number each example | **Not native.** Needs item names and boundaries; a discrete series counter differs from `count-up`. |
| V21 | Draw attention with a note | **Not native.** Handwriting exists, but freely anchored note/arrow paths are not exposed. |
| V22 | Keep a comment prompt pinned | **Not native.** Needs supplied CTA text and a persistent safe-area banner. |
| V23 | Compare a grid of examples | **Not native.** Needs synchronized clip pairs, labels and a multi-video grid. |

### Animated B-roll — 11

| Code | Idea | Current support and inputs |
|---|---|---|
| B1 | Animate a chat exchange | **Not native.** Needs approved conversation text; `chat-takeover` is a video frame, not a scripted chat. |
| B2 | Multiple chat participants | **Not native.** Needs identities, avatars and a message script. |
| B3 | Chat leading to a calendar event | **Not native.** Needs message/event data and a scene sequence; no calendar integration is implied. |
| B4 | Chat leading to files and a table | **Not native.** Needs labels/data and transitions; no Drive or Sheets action is performed. |
| B5 | Phone group conversation | **Not native.** Needs participant assets and approved messages. |
| B6 | Click a desktop app icon | **Not native.** Needs app icons and pointer/opening animation. |
| B7 | Character notification | **Not native.** Needs portrait/text and animation; an audible ping also needs sound support. |
| B8 | Brand name in a pill | **Not native.** Needs official brand assets and a lockup treatment. |
| B9 | Introduce several people | **Not native.** Needs authorized portraits, names and per-person timing. |
| B10 | Explain a concept with a diagram | **Not native.** Needs nodes, relationships, labels and narration cues. |
| B11 | Cinematic brand opening | **Media/edit.** Supply permitted official footage and logos; bespoke logo animation remains separate work. |

### Signature effects — 19

| Code | Idea | Current support and inputs |
|---|---|---|
| X1 | Reel cards orbit the presenter | **Not native.** Needs real card media and front/back person occlusion. Yap's `orbit` uses stock icons without that masking. |
| X2 | Wall of real content | **Not native.** `green-screen` accepts one background asset; a multi-post wall must first be authored as an image/video. |
| X3 | Presenter inside an app world | **Not native.** A chat frame exists; the specific room, prompt and UI composition does not. |
| X4 | Presenter breaks a phone frame | **Existing route, partial.** `frame-escape` provides a related masked card effect, not the exact rounded phone layout. |
| X5 | Digital punch-in | **Existing route.** `snap-zoom` supplies the core punch-in; `digital-zoom` adds a different REC overlay. |
| X6 | Phone and step list | **Not native.** Needs steps and button copy; existing phone animation lacks this beside-presenter sequence. |
| X7 | Tick a short checklist | **Existing route, partial.** `checklist` accepts real items; ticks are distributed over its duration, without per-word tick cues. |
| X8 | A wall of headlines | **Existing route, partial.** `headline-storm` takes supplied headlines; paper/search/quote variants and independent beats are extra work. |
| X9 | Pass through a dark area into a cut | **Existing route, partial.** `zoom-through-cut` bridges a real edit; it lacks a selected dark-object portal and hold. |
| X10 | Growing chart behind the speaker | **Not native.** `growth-curve` is a foreground chart; it does not become masked simply by using this code. |
| X11 | Pull back to reveal an app | **Existing route, partial.** `studio-reveal` is a graphic reveal; it is not a custom task interface or live agent execution. |
| X12 | Two presenter views | **Not native.** Requires a dual-view layout; a real second angle needs another recording. |
| X13 | Paper presenter collage | **Existing route, partial.** `paper-cutout` supplies a silhouette border; tape, torn collage and lettering need additional artwork. |
| X14 | Hand-drawn moving outline | **Not native.** Needs contour extraction and animated strokes; a static outline is not a boiling doodle. |
| X15 | Foreground/background counter-zoom | **Existing route.** `dolly-zoom` simulates the depth effect with a mask; no physical camera reconstruction. |
| X16 | Magazine cover | **Existing route, partial.** `magazine-cover` has masthead and cover lines; exact strapline and typography controls differ. |
| X17 | Glass lettering behind the speaker | **Not native.** `liquid-glass` is a moving lens, not refractive text. |
| X18 | Flip illustrated object cards | **Not native.** Needs licensed object images, labels and a flip-card renderer. |
| X19 | Play an explainer on a dark-room monitor | **Not native.** Needs a monitor scene, title and nested video composition. |

### Motion and editorial pace — 7

| Code | Idea | Current support and inputs |
|---|---|---|
| M1 | Punch in on sentence changes | **Existing route.** The agent selects boundaries and cut framing; not a caption setting. |
| M2 | Blur into and out of cutaways | **Existing route, partial.** A cut bridge exists; arbitrary cutaway orchestration and light leaks require more work. |
| M3 | Change visuals frequently | **Media/edit.** Plan relevant material every few seconds; no automatic-content promise. |
| M4 | Keep the pacing calm | **Existing route, partial.** Use a restrained edit and subtle motion; arbitrary slow camera paths are not available. |
| M5 | Alternate wide and tight takes | **Existing route.** Select sentence ranges and punch-in framing, preserving the speaker's meaning. |
| M6 | Smoothly zoom around the face | **Existing route, partial.** `snap-zoom` is available; custom push/hold/ease-back paths are not. |
| M7 | Wipe between sections with a circle | **Not native.** Needs a transition component tied to real section boundaries. |

### Sound — 3

| Code | Idea | Current support and inputs |
|---|---|---|
| S1 | Sound on each visual event | **Not native.** Needs licensed sound files, cue/gain controls, voice ducking and preview/export mixing. |
| S2 | Occasional sound accents | **Not native.** Requires the same audio-event pipeline, with fewer cues. |
| S3 | Music under the voice | **Not native.** Needs licensed music, trims/loops/fades and ducking. No music-bed track is installed. |

The current engine normalizes the cut's audio and the styles renderer retains
that audio. Uploaded background/B-roll videos play silently beneath it. Do not
call a silent visual a completed sound recipe.

### Finishes — 7

| Code | Idea | Current support and inputs |
|---|---|---|
| G1 | Warm cinematic finish | **Native.** A restrained warm grade and vignette. |
| G2 | Neutral editorial finish | **Native.** Neutral footage and clean type. |
| G3 | Pastel blue finish | **Native.** A blue canvas and framed shot where applicable; no automatic sticker collage. |
| G4 | Pale clean finish | **Native.** Pale surfaces and restrained contrast; does not bundle SF Pro or add arbitrary app widgets. |
| G5 | Soft warm finish | **Native.** Warm footage with cream/butter typography; the X1 orbit remains separate and unsupported. |
| G6 | Cool room, clear presenter | **Native.** A dark teal room treatment with the subject separately masked; needs local cutout support. |
| G7 | Yellow graphic canvas | **Native.** Yellow canvas and framed footage where applicable; not a promise to replace every full-frame background. |

## Fonts and provenance

The adaptation bundles the supplied Inter Tight variable font and Instrument
Serif italic unchanged, with full SIL Open Font License 1.1 notices retrieved
from the official Google Fonts repository. Inter Tight is requested and measured
at weight 800. The archive's two differently named Inter files are identical
variable fonts, so Yap reuses its already bundled, verified Inter weights.
Handwritten and supporting serif treatments use existing licensed Yap fonts;
SF Pro and unavailable system fonts are not redistributed.

Hashes, font metadata and license source URLs are in
[`font-manifest.json`](../studio/public/fonts/brand-nat/font-manifest.json).
The [Inter Tight notice](../studio/public/fonts/brand-nat/InterTight-OFL.txt) and
[Instrument Serif notice](../studio/public/fonts/brand-nat/InstrumentSerif-OFL.txt)
apply to those fonts, not to the entire source pack. No general redistribution
license accompanied the guide. This repository contains newly written native
adaptations and this concise support reference, not the supplied guide's code,
full prose or illustrative sketches. The pack supplies no stock footage, logo,
photograph, music or sound-effect library.
