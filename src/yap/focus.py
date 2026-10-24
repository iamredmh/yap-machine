"""Where on the screen is the action? Suggest a zoom for each screen range.

When the speaker talks over a screen recording, the viewer should be looking at
the part of the screen the speaker is talking about. This watches the
recording for where things change (a menu opening, text arriving, the pointer
moving, a button pressed) and suggests a `screen_crop` for each screen range,
plus times where the action moves so the range could be split.

It sees activity, not meaning: a spinner or a clock also moves. The agent
decides which suggestions to take. Writes cuts/vN/focus.md and focus.json.
"""

from __future__ import annotations

import subprocess

import numpy as np

from .project import Project, fmt_tc, read_json, write_json

W = 320
FPS = 4
WINDOW = 2.0                # seconds per activity window
PIXEL_DELTA = 18            # grey-level change that counts as a changed pixel
TRANSITION = 0.35           # fraction of the frame changing at once: a page change, not an action
STILL = 0.0015              # fraction of the frame changing in a window below which nothing happened
MIN_CROP, NO_ZOOM = 0.4, 0.85
PAD = 0.08
MOVE = 0.22                 # how far (fraction of the screen) the action moves before a split is suggested


def screen_frames(path: str, start: float, dur: float) -> np.ndarray:
    """Grey frames of the screen recording, FPS per second, at W wide."""
    pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{max(0.0, start):.3f}", "-t", f"{dur:.3f}", "-i", path,
                         "-an", "-vf", f"fps={FPS},scale={W}:-2,format=gray", "-f", "rawvideo", "-"], capture_output=True)
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", path], capture_output=True, text=True)
    sw, sh = (int(x) for x in probe.stdout.strip().split(",")[:2])
    h = int(round(W * sh / sw / 2) * 2)
    n = len(pr.stdout) // (W * h)
    return np.frombuffer(pr.stdout[:n * W * h], np.uint8).reshape(n, h, W)


def activity(frames: np.ndarray) -> tuple[np.ndarray, list[float]]:
    """Per-pair change masks, and the fraction of the frame changing in each pair.
    Pairs where most of the frame changed (a page change) are blanked: they say
    nothing about where to look."""
    if len(frames) < 2:
        return np.zeros((0,) + frames.shape[1:], bool), []
    d = np.abs(frames[1:].astype(np.int16) - frames[:-1].astype(np.int16)) > PIXEL_DELTA
    frac = d.mean(axis=(1, 2))
    d = d.copy()
    d[frac > TRANSITION] = False
    return d, [float(f) for f in frac]


def box_of(mask_sum: np.ndarray, lo: float = 4, hi: float = 96) -> list[float] | None:
    """Box (x, y, w, h as fractions) holding the middle of the activity, or None when there is none."""
    h, w = mask_sum.shape
    if mask_sum.sum() < STILL * h * w:
        return None
    ys, xs = np.nonzero(mask_sum)
    wt = mask_sum[ys, xs].astype(float)

    def pct(v, p):
        order = np.argsort(v)
        cum = np.cumsum(wt[order]) / wt.sum()
        return float(v[order][min(len(order) - 1, int(np.searchsorted(cum, p / 100.0)))])

    x0, x1, y0, y1 = pct(xs, lo) / w, (pct(xs, hi) + 1) / w, pct(ys, lo) / h, (pct(ys, hi) + 1) / h
    return [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]


def crop_for(box: list[float]) -> tuple[list[float] | None, float]:
    """A crop (fractions of the screen) around the box that keeps the screen's own shape,
    padded, no tighter than MIN_CROP. None when the action fills too much of the screen to zoom."""
    x, y, w, h = box
    side = min(1.0, max(w, h) * (1 + 2 * PAD))
    side = max(side, MIN_CROP)
    if side >= NO_ZOOM:
        return None, 1.0
    cx, cy = x + w / 2, y + h / 2
    x0 = min(max(cx - side / 2, 0.0), 1.0 - side)
    y0 = min(max(cy - side / 2, 0.0), 1.0 - side)
    return [round(x0, 4), round(y0, 4), round(side, 4), round(side, 4)], round(1 / side, 2)


def split_hints(windows: list[dict]) -> list[float]:
    """Output times where the action jumps to a different part of the screen."""
    hints = []
    prev = None
    for w in windows:
        if w["box"] is None:
            continue
        c = (w["box"][0] + w["box"][2] / 2, w["box"][1] + w["box"][3] / 2)
        if prev is not None and max(abs(c[0] - prev[0]), abs(c[1] - prev[1])) > MOVE:
            hints.append(w["t"])
        prev = c
    return hints


def analyse_range(project: Project, segs: list[dict]) -> dict:
    """Activity across every segment of one screen range (output times)."""
    pooled = None
    windows: list[dict] = []
    transitions: list[float] = []
    for s in segs:
        scr = project.source(s["screen"]["source"])
        dur = s["end"] - s["start"]
        frames = screen_frames(scr["path"], s["screen"]["start"], dur)
        d, frac = activity(frames)
        for k, f in enumerate(frac):
            if f > TRANSITION:
                transitions.append(round(s["out_start"] + (k + 1) / FPS, 2))
        per = int(WINDOW * FPS)
        for a in range(0, len(d), per):
            chunk = d[a:a + per]
            if len(chunk) < 2:
                continue
            ms = chunk.sum(axis=0).astype(np.int32)
            windows.append({"t": round(s["out_start"] + a / FPS, 2), "box": box_of(ms)})
            pooled = ms if pooled is None or pooled.shape != ms.shape else pooled + ms
    box = box_of(pooled) if pooled is not None else None
    crop, zoom = crop_for(box) if box else (None, 1.0)
    return {"box": box, "crop": crop, "zoom": zoom, "windows": windows, "transitions": transitions,
            "split_hints": split_hints(windows)}


def run(project: Project, version: str) -> dict:
    cut = project.cut_dir(version)
    tl = read_json(cut / "timeline.json")
    edl = read_json(cut / "edl.json")
    by_range: dict[int, list[dict]] = {}
    for s in tl["segments"]:
        if s.get("screen"):
            by_range.setdefault(s["range"], []).append(s)
    rows = []
    for ri, segs in sorted(by_range.items()):
        res = analyse_range(project, segs)
        existing = edl["ranges"][ri].get("screen_crop")
        rows.append({"range": ri, "beat": segs[0].get("beat", ""), "start": segs[0]["out_start"], "end": segs[-1]["out_end"],
                     "existing_crop": existing, **res})
    lines = [f"# Where the action is — {version}", "",
             "Suggested `screen_crop` for each screen range, from where things change on the screen recording.",
             "It sees activity, not meaning (a spinner moves too): look before you take one. `zoom` is how much closer it gets.", ""]
    if not rows:
        lines.append("No screen ranges in this cut (set `\"layout\": \"screen\"` on a range).")
    else:
        lines += ["| range | beat | at | length | action box | suggested screen_crop | zoom | action moves at |", "|---|---|---|---|---|---|---|---|"]
        for r in rows:
            box = "·" if not r["box"] else "[" + ", ".join(f"{v:.2f}" for v in r["box"]) + "]"
            crop = ("already " + str(r["existing_crop"])) if r["existing_crop"] else \
                   ("[" + ", ".join(f"{v:.2f}" for v in r["crop"]) + "]" if r["crop"] else "none: the action fills the screen")
            lines.append(f"| {r['range']} | {r['beat']} | {fmt_tc(r['start'])} | {r['end'] - r['start']:.0f}s | {box} | {crop} | "
                         f"{r['zoom'] if r['crop'] else '·'} | {', '.join(fmt_tc(t) for t in r['split_hints']) or '·'} |")
        lines += ["", "To take one, add it to the range in the EDL: `\"screen_crop\": [x, y, w, h]` (fractions of the screen).",
                  "Where the action moves, consider splitting the range there so each part gets its own crop."]
    (cut / "focus.md").write_text("\n".join(lines) + "\n")
    write_json(cut / "focus.json", {"version": version, "ranges": rows})
    return {"ranges": rows}
