# Upload and review design pass — 24 October 2026

The upload and review screens now extend the design established in the Style & export workspace. They share warm white surfaces, sage accents, Geist typography, editorial serif accents, consistent icons and deliberate control sizes.

## Changes

- Upload has a clear drop area, an accessible Choose files button, optional project name, concise file limits and a separate folder-import disclosure. File type, empty-file and size validation produce visible feedback. Import progress and the next step are explicit.
- Project cards use real video posters, a clear review action, concise metadata and expandable source details. Raw filesystem paths no longer compete with the primary task.
- Review uses the same left-hand video canvas and right-hand tools as Style & export. Transcript, notes, checks and unused takes remain available. Notes are timestamped and stay local to the desk until sent to the agent.
- The video has a dedicated transport bar and a compact waveform scrubber. Timeline detail, frame stepping, playback speed and loop ranges remain available without filling the default workspace with controls.
- “Style this cut” carries the selected version into the style editor. Returning to Review retains that selection during the session. This prevents silently styling the newest version when the user was reviewing an older one.
- On phones, the feedback composer expands on demand. Focus enlarges the video, and the note shortcut reopens the panel and focuses the input. The scrubber remains available on short screens.
- Agent chat overlays the workspace on narrower displays instead of squeezing the video into a third column. Showing the review panels does not unexpectedly reopen chat.
- Import names retain their exact casing and punctuation, separately from filesystem-safe project IDs. Retrying preparation does not rename an existing project.
- Render playback no longer reports “0 effects” merely because the editable effect tracks are hidden.

## Verification

- Desk: **185 tests passed across 20 files**. Includes two regression cases for preserving imported project names and source metadata.
- Desk TypeScript checks, production build and `git diff --check` passed.
- Browser QA at 1920 × 1080, 1280 × 720, 943 × 942, 390 × 844 and 375 × 667. No horizontal overflow found. At 1280 × 720 the review video is 391 px tall and the stage fits its viewport without scrolling. On the smaller phone, the expanded note form and scrubber remain reachable; the send button ends at y=657 in a 667 px viewport.
- Checked playback, frame stepping, speed changes, loop start/clear, timeline detail, transcript navigation, timestamped note creation/removal, mobile focus, keyboard note entry and Escape dismissal of playback options.
- Compared two synthetic cut versions: both players played, the intended version supplied audio and the other was muted. Selecting v1 and continuing to Style opened v1 despite v2 being available.
- Folder import was exercised through the UI, including its empty-path validation and prepared-project handoff. Multipart file upload was exercised through the local API with synthetic media. The imported project retained the exact name `Workflow Q&A — Upload QA` and preparation completed.
- Exported the full eight-second synthetic demo through the UI. FFprobe confirmed both video and audio are 8.000 seconds. The ready state displayed the download link and playback controls.
- Temporary notes were removed. Synthetic import and comparison fixtures were archived outside the active project list. Existing reference-clip style drafts were left intact. No agent messages were sent during QA.

The browser file picker itself was not automated; multipart handling and preparation were checked through the local API and existing automated tests. The QA import and export checks used synthetic footage and existing cut fixtures, rather than asking an external agent to generate a new cut.

## Files

Main implementation: `desk/web/src/workflow.css`, `App.tsx`, `ControlBar.tsx`, `StudioIcon.tsx`, `VisualStudio.tsx` and `EditTimeline.tsx`. Name persistence lives in `desk/src/server/footage.ts` and the import lifecycle in `app.ts`.

Screenshots are delivered as `yap-machine-upload-desktop.png`, `yap-machine-upload-mobile.png`, `yap-machine-review-desktop.png`, `yap-machine-review-laptop.png` and `yap-machine-review-mobile.png`.
