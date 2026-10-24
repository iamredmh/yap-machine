"""Measure a reference video, and your own cut the same way, so "make it feel like
this one" becomes numbers the agent can act on.

Measured: length and shape, how often it cuts, how fast and how tight the
speaking is, loudness, how the speaker is framed, and, with Tesseract, how the
captions look (words at a time, where, how big, what colour). The result is a
description of the reference, never a copy of it: nothing from the reference is
used in the edit.

Cut detection and caption reading are estimates (a soft punch-in is not a hard
cut, and any text on screen reads as caption text); the report says so.

    references/<name>.json / .md        what was measured
    cuts/vN/vs-<name>.md                the cut beside the reference, with suggested settings
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from statistics import median

import numpy as np

from .media import probe
from .project import Project, YapError, fmt_tc, read_json, write_json

SCENE = 0.05            # ffmpeg scene score that counts as a cut; low because a jump cut on one camera is subtle
                        # (measured on a cut with known joins: 0.05 found all of them, 0.12 found half)
MIN_SHOT = 0.25         # cuts closer than this are one cut
OCR_MAX_FRAMES = 120
OCR_CONF = 60


# ---------------------------------------------------------------- the basics

def cut_times(path: Path) -> list[float]:
    pr = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-an", "-vf",
                         f"select='gt(scene,{SCENE})',showinfo", "-f", "null", "-"], capture_output=True, text=True)
    times = [float(m) for m in re.findall(r"pts_time:([\d.]+)", pr.stderr)]
    out: list[float] = []
    for t in times:
        if not out or t - out[-1] >= MIN_SHOT:
            out.append(t)
    return out


def shot_stats(cuts: list[float], duration: float) -> dict:
    edges = [0.0] + cuts + [duration]
    shots = [b - a for a, b in zip(edges, edges[1:]) if b - a > 0.05]
    if not shots:
        return {"cuts": 0, "cuts_per_min": 0.0, "shot_median": duration, "shot_mean": duration, "first_cut": None}
    return {"cuts": len(cuts), "cuts_per_min": round(len(cuts) * 60.0 / max(duration, 1), 1),
            "shot_median": round(median(shots), 2), "shot_mean": round(sum(shots) / len(shots), 2),
            "first_cut": round(cuts[0], 2) if cuts else None}


def loudness(path: Path) -> dict:
    from .check import _render_stats
    st = _render_stats(path)
    return {"lufs": st.get("lufs"), "true_peak": st.get("true_peak")}


def speech_stats(path: Path, model: str | None = None) -> dict | None:
    """Pace and pauses of the speaking in a video, or None when nobody speaks."""
    from .delivery import MIN_WORDS, wpm
    from .pack import is_filler, split_phrases
    from .transcribe import find_model, whisper_words
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "a.wav"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-nostdin", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000",
                            "-c:a", "pcm_s16le", str(wav)], capture_output=True, text=True)
        if r.returncode != 0 or not wav.exists() or wav.stat().st_size < 32000:
            return None
        words, _ = whisper_words(wav, find_model(model), "", path.name, verbatim=False)
    if len(words) < 8:
        return None
    paces, gaps = [], []
    phrases = split_phrases(words)
    for k, idx in enumerate(phrases):
        ws = [words[i] for i in idx]
        content = [w for w in ws if not is_filler(w["text"])]
        p = wpm(len(content), ws[-1]["end"] - ws[0]["start"])
        if p and len(content) >= MIN_WORDS:
            paces.append(p)
        if k:
            gaps.append(ws[0]["start"] - words[phrases[k - 1][-1]]["end"])
    talk = words[-1]["end"] - words[0]["start"]
    return {"words": len(words), "first_word": round(words[0]["start"], 2),
            "wpm_overall": wpm(len(words), talk), "wpm_phrase_median": round(median(paces)) if paces else None,
            "gap_median": round(median(gaps), 2) if gaps else None,
            "gap_p90": round(float(np.percentile(gaps, 90)), 2) if gaps else None,
            "fillers_per_100": round(100 * sum(1 for w in words if is_filler(w["text"])) / len(words), 1)}


# ------------------------------------------------------ frames: captions, face

def _frames(path: Path, duration: float, td: Path) -> tuple[list[Path], float]:
    step = max(0.5, duration / OCR_MAX_FRAMES)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-nostdin", "-i", str(path), "-an", "-vf",
                    f"fps={1 / step:.5f},scale=960:-2", str(td / "f%04d.png")], capture_output=True)
    return sorted(td.glob("f*.png")), step


def ocr_boxes(img: Path) -> list[dict]:
    pr = subprocess.run(["tesseract", str(img), "stdout", "--psm", "11", "tsv"], capture_output=True, text=True)
    boxes = []
    for row in pr.stdout.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or c[0] != "5":
            continue
        text = c[11].strip()
        try:
            conf = float(c[10])
        except ValueError:
            continue
        if conf >= OCR_CONF and len(re.sub(r"\W", "", text)) >= 2:
            boxes.append({"x": int(c[6]), "y": int(c[7]), "w": int(c[8]), "h": int(c[9]), "text": text})
    return boxes


def text_lines(boxes: list[dict]) -> list[list[dict]]:
    """Group word boxes into lines by vertical position."""
    lines: list[list[dict]] = []
    for b in sorted(boxes, key=lambda b: (b["y"] + b["h"] / 2)):
        cy = b["y"] + b["h"] / 2
        for ln in lines:
            ly = sum(x["y"] + x["h"] / 2 for x in ln) / len(ln)
            if abs(cy - ly) < 0.6 * max(b["h"], ln[0]["h"]):
                ln.append(b)
                break
        else:
            lines.append([b])
    return [sorted(ln, key=lambda b: b["x"]) for ln in lines]


def text_colour(img, box: dict) -> tuple[int, int, int] | None:
    """Colour of the lettering in a box: the smaller (Otsu) side of its pixels."""
    import cv2
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    roi = img[max(0, y):y + h, max(0, x):x + w]
    if roi.size == 0 or w < 6 or h < 6:
        return None
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    on = mask > 0
    side = on if on.sum() <= (~on).sum() else ~on
    if side.sum() < 8:
        return None
    b, g, r = (int(np.median(roi[..., i][side])) for i in range(3))
    return r, g, b


def hex_colour(c) -> str:
    return "#%02X%02X%02X" % tuple(int(x) for x in c)


def saturation(c) -> float:
    return (max(c) - min(c)) / max(1, max(c))


def lettering_colours(colours: list[tuple]) -> dict:
    """The caption colour and, when one word is picked out, the highlight colour.

    Words are bucketed by colour. The commonest bucket is the lettering; a second
    bucket that is also common and more saturated is the highlight (on two-word
    captions the two are about equally common, so saturation decides, not count)."""
    if not colours:
        return {"colour": None, "highlight": None}
    buckets: dict[tuple, list] = {}
    for c in colours:
        buckets.setdefault(tuple(v // 32 for v in c), []).append(c)
    ranked = sorted(buckets.values(), key=len, reverse=True)

    def rep(group):
        return tuple(int(median([c[i] for c in group])) for i in range(3))

    first = rep(ranked[0])
    if len(ranked) > 1 and len(ranked[1]) >= max(3, 0.1 * len(colours)):
        second = rep(ranked[1])
        base, hi = (first, second) if saturation(first) <= saturation(second) else (second, first)
        if abs(saturation(base) - saturation(hi)) > 0.25 or sum(abs(a - b) for a, b in zip(base, hi)) > 150:
            return {"colour": hex_colour(base), "highlight": hex_colour(hi)}
    return {"colour": hex_colour(first), "highlight": None}


def frame_stats(path: Path, duration: float, ocr: bool = True) -> dict:
    import cv2
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    out: dict = {"frames": 0}
    use_ocr = ocr and shutil.which("tesseract") is not None
    with tempfile.TemporaryDirectory() as td:
        files, step = _frames(path, duration, Path(td))
        out["frames"] = len(files)
        face_h, face_cy, face_cx = [], [], []
        with_text = 0
        chunk, text_h, text_y, colours = [], [], [], []
        changes = 0
        prev = None
        for f in files:
            img = cv2.imread(str(f))
            if img is None:
                continue
            H, W = img.shape[:2]
            g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = casc.detectMultiScale(g, 1.1, 5, minSize=(W // 12, W // 12))
            if len(faces):
                x, y, fw, fh = max(faces, key=lambda r: r[2] * r[3])
                face_h.append(fh / H)
                face_cy.append((y + fh / 2) / H)
                face_cx.append((x + fw / 2) / W)
            if not use_ocr:
                continue
            lines = text_lines(ocr_boxes(f))
            if not lines:
                prev = None
                continue
            with_text += 1
            ln = max(lines, key=len)
            words = tuple(b["text"].lower() for b in ln)
            if prev is not None and words != prev:
                changes += 1
            prev = words
            chunk.append(len(ln))
            text_h.append(float(median([b["h"] for b in ln])) / H)
            text_y.append(float(median([b["y"] + b["h"] / 2 for b in ln])) / H)
            colours += [c for c in (text_colour(img, b) for b in ln) if c]
    if face_h:
        out["face"] = {"found_in": round(len(face_h) / max(1, out["frames"]), 2), "height": round(median(face_h), 3),
                       "centre_y": round(median(face_cy), 3), "centre_x": round(median(face_cx), 3)}
    if use_ocr:
        out["text"] = {"frames_with_text": round(with_text / max(1, out["frames"]), 2)}
        if chunk:
            out["text"].update({
                "words_at_a_time": round(float(median(chunk))), "height": round(median(text_h), 3),
                "centre_y": round(median(text_y), 3), **lettering_colours(colours),
                "changes_per_sec": round(changes / max(1.0, len(chunk) * step), 2)})
    else:
        out["text"] = None
    return out


# ---------------------------------------------------------------------- main

def measure(path: Path, asr: bool = True, ocr: bool = True, model: str | None = None) -> dict:
    path = Path(path).expanduser()
    if not path.exists():
        raise YapError(f"no such video: {path}")
    info = probe(path)
    if not info.get("has_video"):
        raise YapError(f"{path.name} has no picture")
    dur = info["duration"]
    w, h = info.get("width") or 0, info.get("height") or 0
    if info.get("rotation") in (90, -90, 270, -270):
        w, h = h, w
    cuts = cut_times(path)
    return {"file": path.name, "duration": round(dur, 2), "width": w, "height": h, "fps": info.get("fps"),
            "aspect": "vertical" if h > w else "square" if h == w else "wide",
            "shots": shot_stats(cuts, dur), "loudness": loudness(path),
            "speech": speech_stats(path, model) if asr and info.get("has_audio") else None,
            "frames": frame_stats(path, dur, ocr)}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", Path(name).stem.lower()).strip("-") or "reference"


def describe(m: dict) -> list[str]:
    s, sp, fr = m["shots"], m["speech"], m["frames"]
    lines = [f"- **{m['aspect']}** {m['width']}×{m['height']}, {fmt_tc(m['duration'])}, {m['fps']} fps",
             f"- Cuts: {s['cuts']} (**{s['cuts_per_min']} a minute**), shots run {s['shot_median']}s typically"
             + (f", first cut at {s['first_cut']}s" if s["first_cut"] is not None else "")]
    if sp:
        lines.append(f"- Speaking: starts at {sp['first_word']}s; **{sp['wpm_phrase_median']} wpm** typical phrase "
                     f"({sp['wpm_overall']} over everything); gap between phrases {sp['gap_median']}s typically, 90% under {sp['gap_p90']}s; "
                     f"{sp['fillers_per_100']} fillers per 100 words")
    elif m["speech"] is None:
        lines.append("- Speaking: none heard (or not measured)")
    lu = m["loudness"]
    if lu.get("lufs") is not None:
        lines.append(f"- Loudness: {lu['lufs']} LUFS, peak {lu['true_peak']} dBFS")
    if fr.get("face"):
        f = fr["face"]
        lines.append(f"- Speaker framing: face {f['height']:.0%} of the frame height, centred {f['centre_y']:.0%} down and "
                     f"{f['centre_x']:.0%} across (found in {f['found_in']:.0%} of sampled frames)")
    t = fr.get("text")
    if t is None:
        lines.append("- Captions: not read (install Tesseract: `brew install tesseract`)")
    elif "words_at_a_time" in t:
        lines.append(f"- Text on screen in {t['frames_with_text']:.0%} of frames: **{t['words_at_a_time']} words at a time**, "
                     f"{t['centre_y']:.0%} down the frame, letter height {t['height']:.1%} of frame height, "
                     f"changing {t['changes_per_sec']}×/s" + (f", colour {t['colour']}" if t["colour"] else "")
                     + (f", one word picked out in {t['highlight']}" if t["highlight"] else ""))
    else:
        lines.append(f"- Captions: text found in {t['frames_with_text']:.0%} of sampled frames (none worth reading)")
    return lines


def suggest(ref: dict) -> dict:
    """Settings that would move a cut towards this reference. Measurements, not orders."""
    out: dict = {}
    sp, t = ref["speech"], ref["frames"].get("text")
    if sp and sp.get("gap_median") is not None:
        out["edl"] = {"max_pause": round(min(1.0, max(0.25, sp["gap_median"] + 0.1)), 2)}
    if t and "words_at_a_time" in t and t["frames_with_text"] >= 0.3:
        preset = "short" if ref["aspect"] == "vertical" else "long"
        cap = {"max_words": max(1, t["words_at_a_time"]), "y": t["centre_y"]}
        # Tesseract's box is the letter height; a font's size is ~1.4× that
        short_side = min(ref["width"], ref["height"])
        cap["size"] = round(t["height"] * ref["height"] * 1.4 / short_side, 3)
        if t["colour"]:
            cap["color"] = t["colour"]
        if t["highlight"]:
            cap.update({"highlight": True, "active": t["highlight"]})
        out["style"] = {"captions": {preset: cap}}
    return out


def write_reference(project: Project, m: dict) -> Path:
    d = project.root / "references"
    d.mkdir(exist_ok=True)
    name = slug(m["file"])
    write_json(d / f"{name}.json", m)
    lines = [f"# Reference — {m['file']}", "", "Measured, not copied. Cut detection and caption reading are estimates.", "",
             *describe(m)]
    sug = suggest(m)
    if sug:
        import json
        lines += ["", "## Settings that would move a cut towards it", "",
                  "Merge into `style.json` / the EDL if you want them; each is a measurement turned into a number.", "",
                  "```json", json.dumps(sug, indent=2), "```"]
    (d / f"{name}.md").write_text("\n".join(lines) + "\n")
    return d / f"{name}.md"


def compare(project: Project, ref: dict, version: str, asr: bool = True, ocr: bool = True) -> Path:
    render = project.render_path(version)
    if not render.exists():
        render = project.render_path(version, draft=True)
    if not render.exists():
        raise YapError(f"no render of {version} to measure; run `yap-machine render {version}` first")
    mine = measure(render, asr=asr, ocr=ocr)

    def g(m, *keys):
        for k in keys:
            m = (m or {}).get(k) if isinstance(m, dict) else None
        return m

    rows = [("cuts a minute", g(ref, "shots", "cuts_per_min"), g(mine, "shots", "cuts_per_min")),
            ("typical shot (s)", g(ref, "shots", "shot_median"), g(mine, "shots", "shot_median")),
            ("first cut (s)", g(ref, "shots", "first_cut"), g(mine, "shots", "first_cut")),
            ("speech starts (s)", g(ref, "speech", "first_word"), g(mine, "speech", "first_word")),
            ("pace (wpm, typical phrase)", g(ref, "speech", "wpm_phrase_median"), g(mine, "speech", "wpm_phrase_median")),
            ("typical gap between phrases (s)", g(ref, "speech", "gap_median"), g(mine, "speech", "gap_median")),
            ("loudness (LUFS)", g(ref, "loudness", "lufs"), g(mine, "loudness", "lufs")),
            ("face height (fraction of frame)", g(ref, "frames", "face", "height"), g(mine, "frames", "face", "height")),
            ("caption words at a time", g(ref, "frames", "text", "words_at_a_time"), g(mine, "frames", "text", "words_at_a_time")),
            ("caption position (fraction down)", g(ref, "frames", "text", "centre_y"), g(mine, "frames", "text", "centre_y")),
            ("caption letter height", g(ref, "frames", "text", "height"), g(mine, "frames", "text", "height"))]
    lines = [f"# {version} against {ref['file']}", "", "| | reference | yours |", "|---|---|---|"]
    lines += [f"| {n} | {a if a is not None else '·'} | {b if b is not None else '·'} |" for n, a, b in rows]
    sug = suggest(ref)
    if sug:
        import json
        lines += ["", "Settings that would move the cut towards the reference (apply only what the brief asks for):", "",
                  "```json", json.dumps(sug, indent=2), "```"]
    out = project.cut_dir(version) / f"vs-{slug(ref['file'])}.md"
    out.write_text("\n".join(lines) + "\n")
    return out
