"""Screen-recording layout: the screen fills the frame, the speaker sits in a
rounded picture-in-picture cut around their face.

A range opts in with "layout": "screen" (and optionally "screen_crop":
[x, y, w, h] as fractions of the screen recording, to zoom into what's being
talked about). The screen recording must be synced to the camera
(`yap-machine prep` does this when both recorded the same voice).
"""

from __future__ import annotations

import numpy as np

from .project import Project, YapError, fmt_tc

PIP_SIZE = 0.27        # picture-in-picture height, fraction of frame height
PIP_MARGIN = 0.03      # from the right edge, fraction of width
PIP_BOTTOM = 0.76      # bottom of the PiP, fraction of height (clear of captions)
PIP_BORDER = 0.006     # white border, fraction of height
PIP_RADIUS = 0.22      # corner radius, fraction of PiP size


def _screen_for(project: Project, camera_id: str, wanted: str | None) -> dict:
    for s in project.sources():
        if s["kind"] != "screen":
            continue
        if wanted and s["id"] != wanted:
            continue
        if s.get("sync", {}).get("to") == camera_id:
            return s
    raise YapError(f"no screen recording synced to {camera_id}"
                   + (f" (asked for {wanted})" if wanted else "") + "; run `yap-machine prep` with the screen in the footage folder")


def pip_crop(samples, src: dict) -> list[float]:
    """A square around the face (with chin and some shoulder), as fractions."""
    sw, sh = src.get("width") or 1920, src.get("height") or 1080
    if samples:
        cx = float(np.median([x[1] for x in samples]))
        cy = float(np.median([x[2] for x in samples]))
        fh = float(np.median([x[3] for x in samples]))
    else:
        cx, cy, fh = 0.5, 0.42, 0.35
    side_h = min(1.0, 2.3 * fh)
    side_w = side_h * sh / sw
    x = min(max(cx - side_w / 2, 0.0), 1.0 - side_w)
    y = min(max(cy + 0.12 * fh - side_h / 2, 0.0), 1.0 - side_h)
    return [round(x, 5), round(y, 5), round(side_w, 5), round(side_h, 5)]


def place_screens(project: Project, edl: dict, segments: list[dict]) -> list[str]:
    from .reframe import faces
    notes = []
    for s in segments:
        if s["layout"] != "screen":
            continue
        rng = edl["ranges"][s["range"]]
        scr = _screen_for(project, s["source"], rng.get("screen"))
        t = s["start"] + scr["sync"]["offset"]
        if t < 0 or t + (s["end"] - s["start"]) > scr["duration"]:
            raise YapError(f"{fmt_tc(s['start'])}: the screen recording doesn't cover this part of {s['source']}")
        s["screen"] = {"source": scr["id"], "start": round(t, 4), "crop": rng.get("screen_crop")}
        src = project.source(s["source"])
        s["pip"] = pip_crop(faces(project, src, s["start"], s["end"]), src)
    return notes


def _mask(size: int, radius: int) -> str:
    h = size / 2
    return (f"if(lte(hypot(max(0\\,abs(X-{h})-{h - radius})\\,max(0\\,abs(Y-{h})-{h - radius}))\\,{radius})\\,255\\,0)")


def screen_filter(seg: dict, W: int, H: int, fps: float, canvas: str) -> str:
    """filter_complex for one screen segment: inputs 0 = camera, 1 = screen. Output [v]."""
    P = int(round(PIP_SIZE * H / 2) * 2)
    B = max(2, int(round(PIP_BORDER * H)))
    R = int(PIP_RADIUS * P)
    x = W - int(PIP_MARGIN * W) - (P + 2 * B)
    y = int(PIP_BOTTOM * H) - (P + 2 * B)
    sc = ""
    if seg["screen"].get("crop"):
        cx, cy, cw, ch = seg["screen"]["crop"]
        sc = f"crop=trunc(iw*{cw}/2)*2:trunc(ih*{ch}/2)*2:trunc(iw*{cx}):trunc(ih*{cy}),"
    px, py, pw, ph = seg["pip"]
    canvas = canvas.lstrip("#")
    return ";".join([
        f"[1:v]setpts=PTS-STARTPTS,{sc}scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x{canvas},setsar=1,fps={fps}[bg]",
        f"[0:v]setpts=PTS-STARTPTS,crop=trunc(iw*{pw}/2)*2:trunc(ih*{ph}/2)*2:trunc(iw*{px}):trunc(ih*{py}),"
        f"scale={P}:{P}:flags=lanczos,fps={fps},format=yuva444p,"
        f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='{_mask(P, R)}'[pip]",
        f"color=c=0xE7E5E4:s={P + 2 * B}x{P + 2 * B}:r={fps},format=yuva444p,"
        f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='{_mask(P + 2 * B, R + B)}'[edge]",
        f"[edge][pip]overlay={B}:{B}:shortest=1[pipf]",
        f"[bg][pipf]overlay={x}:{y}:shortest=1,format=yuv420p[v]",
    ])
