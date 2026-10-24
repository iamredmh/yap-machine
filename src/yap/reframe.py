"""Reframe a cut for another aspect ratio (e.g. 16:9 → 9:16) around the speaker's face.

Faces are detected on the source a few times a second (OpenCV's bundled
frontal-face model, no download), cached per source. Each segment gets one
static crop: the speaker's face held at the same height and centred across,
so a vertical short never pans mid-sentence. Crops are stored on the timeline
as fractions of the source frame: [x, y, w, h].
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

from .project import Project, YapError, write_json

SAMPLE_FPS = 4
DET_W, DET_H = 960, 540
FACE_Y = 0.36        # face centre sits this far down the crop
HAIR = 0.6           # top of head above the detected face box, in face heights (hair, forehead)
HEADROOM = 0.05      # space kept above the head, as a fraction of the crop
CHIN = 0.12          # chin below the detected face box, in face heights
MAX_TALL_CHIN = 0.78 # vertical: keep the chin above this so captions fit beneath


def _detector():
    try:
        import cv2
    except ImportError as e:
        raise YapError("reframing needs OpenCV: `uv add 'opencv-python-headless<5'`") from e
    path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    casc = cv2.CascadeClassifier(path)
    if casc.empty():
        raise YapError(f"OpenCV face model missing at {path}")
    return casc


def _detect(casc, gray: np.ndarray) -> tuple[float, float, float] | None:
    """Largest face as (cx, cy, height), fractions of the frame."""
    h, w = gray.shape
    faces = casc.detectMultiScale(gray, 1.1, 5, minSize=(h // 12, h // 12))
    if len(faces) == 0:
        return None
    x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    return ((x + fw / 2) / w, (y + fh / 2) / h, fh / h)


def faces(project: Project, src: dict, t0: float, t1: float) -> list[tuple[float, float, float, float]]:
    """(t, cx, cy, fh) samples in [t0, t1], cached per source."""
    cache_path = project.root / "cache" / f"{src['id']}.faces.json"
    cache: dict[str, list | None] = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    need = [k for k in range(int(t0 * SAMPLE_FPS), int(t1 * SAMPLE_FPS) + 1) if str(k) not in cache]
    if need:
        casc = _detector()
        # decode the needed span once, sampling at SAMPLE_FPS
        a, b = need[0] / SAMPLE_FPS, need[-1] / SAMPLE_FPS + 1 / SAMPLE_FPS
        proc = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{a:.3f}", "-i", src["path"],
                               "-t", f"{b - a:.3f}", "-vf",
                               f"fps={SAMPLE_FPS},scale={DET_W}:{DET_H},format=gray",
                               "-f", "rawvideo", "-"], capture_output=True)
        frames = np.frombuffer(proc.stdout, np.uint8)
        n = len(frames) // (DET_W * DET_H)
        frames = frames[:n * DET_W * DET_H].reshape(n, DET_H, DET_W)
        base = need[0]
        for i in range(n):
            if str(base + i) not in cache:
                cache[str(base + i)] = _detect(casc, frames[i])
        write_json(cache_path, cache)
    out = []
    for k in range(int(t0 * SAMPLE_FPS), int(t1 * SAMPLE_FPS) + 1):
        f = cache.get(str(k))
        if f:
            out.append((k / SAMPLE_FPS, *f))
    return out


def crop_for(samples, src: dict, out_w: int, out_h: int, zoom: float, fallback=None) -> list[float]:
    """One static crop [x, y, w, h] (fractions) for a segment."""
    sw, sh = src.get("width") or 1920, src.get("height") or 1080
    h = 1.0 / zoom
    w = h * (out_w / out_h) / (sw / sh)
    if w > 1.0:                       # target is wider than source: fit width instead
        w = 1.0 / zoom
        h = w * (sw / sh) / (out_w / out_h)
    fh = 0.0
    if samples:
        cx = float(np.median([s[1] for s in samples]))
        cy = float(np.median([s[2] for s in samples]))
        fh = float(np.median([s[3] for s in samples]))
    elif fallback:
        cx, cy = fallback[:2]
        fh = fallback[2] if len(fallback) > 2 else 0.0
    else:
        cx, cy = 0.5, 0.4
    x = min(max(cx - w / 2, 0.0), 1.0 - w)
    y = cy - FACE_Y * h
    if fh:
        # the face box stops at the brow; hair sits ~0.35 face-heights above it.
        head_top = cy - fh / 2 - HAIR * fh
        y = min(y, head_top - HEADROOM * h)
    y = min(max(y, 0.0), 1.0 - h)
    return [round(x, 5), round(y, 5), round(w, 5), round(h, 5)]


def reframe_segments(project: Project, segments: list[dict], out_w: int, out_h: int) -> list[str]:
    """Give every segment a face-centred crop. Returns notes for anything doubtful."""
    notes: list[str] = []
    last = None
    skipped = 0
    for s in segments:
        src = project.source(s["source"])
        smp = faces(project, src, s["start"], s["end"])
        if not smp:
            notes.append(f"no face found in {s['source']} {s['start']:.1f}-{s['end']:.1f}s; reusing the last framing")
        else:
            spread = max(x[1] for x in smp) - min(x[1] for x in smp)
            if spread > 0.12:
                notes.append(f"speaker moves across the frame in {s['start']:.1f}-{s['end']:.1f}s "
                             f"({spread:.0%} of width); a static crop may clip them")
            last = tuple(float(np.median([x[i] for x in smp])) for i in (1, 2, 3))
        s["crop"] = crop_for(smp, src, out_w, out_h, s.get("zoom", 1.0), fallback=last)
        if last and out_h > out_w and s.get("zoom", 1.0) > 1.0:
            cy, fh = last[1], last[2]
            x, y, w, h = s["crop"]
            if (cy + fh / 2 + CHIN * fh - y) / h > MAX_TALL_CHIN:
                # a close shot punched in pushes the chin into the caption zone: don't
                s["zoom"] = 1.0
                s["crop"] = crop_for(smp, src, out_w, out_h, 1.0, fallback=last)
                skipped += 1
        if last:
            # where the chin sits in the output frame (face box stops above the chin)
            cy, fh = last[1], last[2]
            x, y, w, h = s["crop"]
            s["face_bottom"] = round(min(1.0, (cy + fh / 2 + CHIN * fh - y) / h), 4)
    if skipped:
        notes.append(f"punch-in skipped on {skipped} vertical segment(s): the speaker is framed close, "
                     "zooming would push the chin into the caption zone")
    return notes
