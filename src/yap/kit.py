"""The posting kit for a finished cut: chapters, transcript, thumbnail picks.

The engine supplies the facts and the files a platform wants; the agent writes
the words (titles, description, summary, hooks) into kit/post.md.

    cuts/vN/kit/
      facts.md        beats with timecodes and their text, pace, the chapters as understood
      chapters.txt    YouTube chapter list (only when the EDL names chapters)
      transcript.txt  the cut as text, with timecodes
      thumbs/*.jpg    the strongest still frames: face in shot, sharp, well placed
      kit.json        the same, machine-readable

Chapters are named in the EDL: "chapters": [{"range": 3, "title": "Picking a model"}, …]
(or {"at": 95.0, …} for an output time). The first lands on 0:00.
"""

from __future__ import annotations

import subprocess

import numpy as np

from .delivery import cut_report
from .project import Project, YapError, fmt_tc, read_json, write_json

MIN_CHAPTERS = 3
MIN_CHAPTER_LEN = 10.0      # YouTube ignores chapter lists with a chapter shorter than this
THUMB_STEP = 1.5            # seconds between candidate frames
THUMB_GAP = 8.0             # picks are at least this far apart
THUMB_COUNT = 6


def yt_time(t: float) -> str:
    t = int(round(t))
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def range_starts(timeline: dict) -> dict[int, float]:
    """Output time at which each EDL range first plays."""
    out: dict[int, float] = {}
    for s in timeline["segments"]:
        out.setdefault(s["range"], s["out_start"])
    return out


def resolve_chapters(edl: dict, timeline: dict) -> list[dict]:
    starts = range_starts(timeline)
    out = []
    for c in edl.get("chapters", []) or []:
        if "range" in c:
            if int(c["range"]) not in starts:
                raise YapError(f"chapter \"{c.get('title')}\" points at range {c['range']}, which the cut doesn't play")
            t = starts[int(c["range"])]
        elif "at" in c:
            t = float(c["at"])
        else:
            raise YapError(f"chapter \"{c.get('title')}\" needs a \"range\" or an \"at\"")
        out.append({"at": round(t, 2), "title": str(c["title"]).strip()})
    out.sort(key=lambda c: c["at"])
    if out:
        out[0]["at"] = 0.0
    return out


def chapter_problems(chapters: list[dict], duration: float) -> list[str]:
    problems = []
    if len(chapters) < MIN_CHAPTERS:
        problems.append(f"YouTube needs at least {MIN_CHAPTERS} chapters; this has {len(chapters)}")
    ends = [c["at"] for c in chapters[1:]] + [duration]
    for c, end in zip(chapters, ends):
        if end - c["at"] < MIN_CHAPTER_LEN:
            problems.append(f"chapter \"{c['title']}\" at {yt_time(c['at'])} is {end - c['at']:.0f}s; chapters must run {MIN_CHAPTER_LEN:.0f}s or more")
    return problems


def beat_blocks(timeline: dict) -> list[dict]:
    """Consecutive segments under one beat label, with their text."""
    blocks: list[dict] = []
    for s in timeline["segments"]:
        label = s.get("beat") or f"range {s['range']}"
        if blocks and blocks[-1]["range"] == s["range"]:
            blocks[-1]["end"] = s["out_end"]
            blocks[-1]["text"] += " " + s["text"]
        else:
            blocks.append({"range": s["range"], "beat": label, "start": s["out_start"], "end": s["out_end"], "text": s["text"]})
    return blocks


def thumbnails(render, timeline: dict, out_dir, count: int = THUMB_COUNT) -> list[dict]:
    """Candidate stills from the render: a face in shot, sharp, roughly centred, spread through the cut."""
    import cv2
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    W = 480
    H = int(round(W * timeline["height"] / timeline["width"] / 2) * 2)
    pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(render), "-vf",
                         f"fps={1 / THUMB_STEP},scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True)
    n = len(pr.stdout) // (W * H)
    frames = np.frombuffer(pr.stdout[:n * W * H], np.uint8).reshape(n, H, W)
    scored = []
    for i, g in enumerate(frames):
        t = i * THUMB_STEP + THUMB_STEP / 2
        f = casc.detectMultiScale(g, 1.1, 5, minSize=(W // 10, W // 10))
        if len(f) == 0:
            continue
        x, y, fw, fh = max(f, key=lambda r: r[2] * r[3])
        sharp = float(cv2.Laplacian(g[y:y + fh, x:x + fw], cv2.CV_64F).var())
        centred = 1.0 - min(1.0, abs((x + fw / 2) / W - 0.5) * 2)
        scored.append({"at": round(t, 2), "score": (fw * fh / (W * H)) ** 0.5 * (sharp ** 0.5) * (0.5 + 0.5 * centred)})
    picks: list[dict] = []
    for c in sorted(scored, key=lambda c: -c["score"]):
        if all(abs(c["at"] - p["at"]) >= THUMB_GAP for p in picks):
            picks.append(c)
        if len(picks) >= count:
            break
    picks.sort(key=lambda p: p["at"])
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.jpg"):
        old.unlink()
    for p in picks:
        name = f"thumb-{int(p['at'] * 100):05d}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-nostdin", "-ss", f"{p['at']:.3f}", "-i", str(render),
                        "-frames:v", "1", "-q:v", "2", str(out_dir / name)], capture_output=True)
        p["file"] = f"thumbs/{name}"
        p["score"] = round(p["score"], 2)
    return picks


def build(project: Project, version: str, with_thumbs: bool = True) -> dict:
    cut = project.cut_dir(version)
    tl = read_json(cut / "timeline.json")
    edl = read_json(cut / "edl.json")
    kit = cut / "kit"
    kit.mkdir(exist_ok=True)

    chapters = resolve_chapters(edl, tl)
    problems = chapter_problems(chapters, tl["duration"]) if chapters else []
    blocks = beat_blocks(tl)
    if chapters and not problems:
        (kit / "chapters.txt").write_text("\n".join(f"{yt_time(c['at'])} {c['title']}" for c in chapters) + "\n")
    elif (kit / "chapters.txt").exists():
        (kit / "chapters.txt").unlink()

    (kit / "transcript.txt").write_text(
        "\n\n".join(f"[{fmt_tc(b['start'])[:5]}] {b['text']}" for b in blocks) + "\n")

    thumbs = []
    render = project.render_path(version)
    if not render.exists():
        render = project.render_path(version, draft=True)
    if with_thumbs and render.exists():
        thumbs = thumbnails(render, tl, kit / "thumbs")

    pace = cut_report(project, version)
    lines = [f"# Posting kit facts — {version}", "",
             f"{fmt_tc(tl['duration'])} long, {pace['words']} words, {pace['overall_wpm']} wpm. "
             f"Brief: {edl.get('brief', '(none)')}", "",
             "Write the post yourself in `kit/post.md`: title options, description (put chapters.txt in it), a three-line summary, "
             "hook variants taken from the cut's own opening lines. Use the beats below as the story.", "",
             "## Beats (candidate chapters)", "", "| range | at | beat | opens with |", "|---|---|---|---|"]
    for b in blocks:
        lines.append(f"| {b['range']} | {yt_time(b['start'])} | {b['beat']} | {' '.join(b['text'].split()[:14])}… |")
    lines += ["", "## Chapters"]
    if not chapters:
        lines += ["", "None named. Add `\"chapters\": [{\"range\": 0, \"title\": \"…\"}, …]` to the EDL (3 or more, each 10s or longer; "
                  "the first lands on 0:00) and run `yap-machine kit` again."]
    elif problems:
        lines += ["", "**Not written to chapters.txt** — " + "; ".join(problems)]
    else:
        lines += ["", *(f"- {yt_time(c['at'])} {c['title']}" for c in chapters), "", "Written to `chapters.txt`."]
    if thumbs:
        lines += ["", "## Thumbnail picks", "", "Face in shot, sharp, roughly centred, at least 8s apart. Look at them; pick one.", ""]
        lines += [f"- {fmt_tc(t['at'])}  `{t['file']}`  (score {t['score']})" for t in thumbs]
    (kit / "facts.md").write_text("\n".join(lines) + "\n")
    write_json(kit / "kit.json", {"version": version, "duration": tl["duration"], "chapters": chapters,
                                  "chapter_problems": problems, "beats": blocks, "thumbs": thumbs, "wpm": pace["overall_wpm"]})
    return {"chapters": chapters, "problems": problems, "thumbs": thumbs, "dir": kit}
