"""Line up a separate mic recording with the camera it was recorded alongside.

Two independent methods:

  picture  the speaker's mouth movement (frame-to-frame motion in the part of
           the frame that moves with speech) against the mic's speech envelope.
           Works whatever the camera recorded for sound.
  audio    the camera's own scratch audio against the mic. Only used when the
           camera actually captured speech, and cross-checked with picture.

A camera that recorded silence (no mic plugged in, input off) makes audio
correlation lock onto noise with false confidence — T1 did exactly that.

Result on the camera source:
  audio = {"source": mic_id, "offset": s, "drift_ppm": d, "range": [c0, c1], "method": ...}
  mic_time = offset + camera_time * (1 + drift_ppm / 1e6), valid for camera times c0..c1.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .media import load_audio, rms_envelope
from .project import Project, YapError

AUDIO_SR = 4000
GRID_H, GRID_W = 6, 12
THUMB_W, THUMB_H = 96, 54
CAMERA_SPEECH_DB = -55.0      # loud frames quieter than this: the camera heard no speech
MIN_PICTURE_R = 0.25
MIN_AUDIO_CONF = 20.0


def mic_time(audio: dict, cam_t: float) -> float:
    return audio["offset"] + cam_t * (1 + audio.get("drift_ppm", 0.0) / 1e6)


def _z(x: np.ndarray) -> np.ndarray:
    return (x - x.mean()) / (x.std() + 1e-9)


def _xcorr(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """c[k] ~ sum_i b[i + k] * a[i] for every lag (negative lags wrapped)."""
    n = 1
    while n < len(a) + len(b):
        n *= 2
    return np.fft.irfft(np.fft.rfft(b, n) * np.conj(np.fft.rfft(a, n)), n)


# -------- audio ---------------------------------------------------------------

def camera_heard_speech(camera: Path) -> bool:
    x = load_audio(camera, 16000)
    if len(x) == 0:
        return False
    env = rms_envelope(x, 16000, hop=0.02)
    return float(np.percentile(env, 95)) > CAMERA_SPEECH_DB


def audio_offset(camera: Path, mic: Path) -> tuple[float, float]:
    def prep(x):
        x = x - x.mean()
        x = np.append(x[0], x[1:] - 0.95 * x[:-1])
        return x / (x.std() or 1)
    a, b = prep(load_audio(camera, AUDIO_SR)), prep(load_audio(mic, AUDIO_SR))
    corr = np.abs(_xcorr(a, b))
    k = int(np.argmax(corr))
    lag = k if k < len(corr) // 2 else k - len(corr)
    return lag / AUDIO_SR, float(corr[k] / (np.median(corr) + 1e-9))


# -------- picture -------------------------------------------------------------

def motion_cells(video: Path, fps: float, start: float = 0.0, duration: float | None = None) -> np.ndarray:
    """Frame-to-frame motion per grid cell, shape (frames-1, cells)."""
    span = (["-ss", f"{start:.3f}"] if start else []) + ["-i", str(video)] + (["-t", f"{duration:.3f}"] if duration else [])
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", *span, "-vf",
         f"fps={fps},scale={THUMB_W}:{THUMB_H},format=gray", "-f", "rawvideo", "-"],
        capture_output=True)
    if proc.returncode != 0:
        raise YapError(f"could not decode {video} for picture sync")
    v = np.frombuffer(proc.stdout, np.uint8).reshape(-1, THUMB_H, THUMB_W)
    ch, cw = THUMB_H // GRID_H, THUMB_W // GRID_W
    out = np.empty((len(v) - 1, GRID_H * GRID_W), np.float32)
    for i in range(0, len(v) - 1, 2000):  # chunked to keep memory flat
        d = np.abs(np.diff(v[i:i + 2001].astype(np.int16), axis=0)).astype(np.float32)
        out[i:i + len(d)] = d.reshape(len(d), GRID_H, ch, GRID_W, cw).mean(axis=(2, 4)).reshape(len(d), -1)
    return out


def speech_envelope(audio_path: Path, fps: float, start: float = 0.0, duration: float | None = None) -> np.ndarray:
    x = load_audio(audio_path, 16000, start=start, duration=duration)
    hop = int(round(16000 / fps))
    n = len(x) // hop
    e = 20 * np.log10(np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
    return np.clip(e, np.percentile(e, 20), None)


def picture_sync(cells: np.ndarray, env: np.ndarray, fps: float) -> dict | None:
    """Find the mouth cell and the lag; then refine in windows for drift."""
    E = _z(env)
    best = None
    for c in range(cells.shape[1]):
        m = _z(np.log(cells[:, c] + 1e-3))
        cc = _xcorr(m, E) / min(len(m), len(E))
        k = int(np.argmax(cc))
        if best is None or cc[k] > best[0]:
            best = (float(cc[k]), c, k, cc)
    r, cell, k, cc = best
    if r < MIN_PICTURE_R:
        return None
    n = len(cc)
    y0, y1, y2 = cc[k - 1], cc[k], cc[(k + 1) % n]
    frac = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
    lag = (k if k < n // 2 else k - n) + frac
    offset = (lag + 0.5) / fps          # a motion sample sits between two frames
    # windowed refinement → linear fit for clock drift
    m = _z(np.log(cells[:, cell] + 1e-3))
    win, step = int(40 * fps), int(30 * fps)
    ts, offs = [], []
    for s in range(0, len(m) - win, step):
        mm = _z(m[s:s + win])
        base = int(round(s + offset * fps))
        scores = []
        for d in range(-12, 13):
            e0 = base + d
            if e0 < 0 or e0 + win > len(env):
                scores.append(-1.0)
                continue
            scores.append(float((mm * _z(env[e0:e0 + win])).mean()))
        j = int(np.argmax(scores))
        if scores[j] > 0.3:
            ts.append((s + win / 2) / fps)
            offs.append(offset + (j - 12) / fps)
    drift = 0.0
    if len(ts) >= 4:
        slope, icept = np.polyfit(ts, offs, 1)
        drift = float(slope) * 1e6
        if abs(drift) > 2000:            # implausible: keep the constant offset
            drift = 0.0
        else:
            offset = float(icept)
    return {"offset": round(float(offset), 4), "drift_ppm": round(drift, 1), "r": round(r, 3),
            "cell": [cell // GRID_W, cell % GRID_W], "windows": len(ts)}


# -------- orchestration -------------------------------------------------------

def sync(project: Project) -> list[dict]:
    data = project.load()
    sources = data["sources"]
    cams = [s for s in sources if s["kind"] == "camera" and not s.get("skip")]
    mics = [s for s in sources if s["kind"] == "audio" and not s.get("skip")]
    results = []
    for cam in cams:
        if not mics:
            continue
        fps = cam.get("fps") or 25.0
        cells = motion_cells(Path(cam["path"]), fps)
        heard = camera_heard_speech(Path(cam["path"]))
        best = None
        for mic in mics:
            pic = picture_sync(cells, speech_envelope(Path(mic["path"]), fps), fps)
            aud = audio_offset(Path(cam["path"]), Path(mic["path"])) if heard else None
            res = {"camera": cam["id"], "mic": mic["id"], "camera_heard_speech": heard,
                   "picture": pic, "audio": {"offset": round(aud[0], 4), "confidence": round(aud[1], 1)} if aud else None}
            chosen = None
            if pic and aud and abs(aud[0] - pic["offset"]) <= 3 / fps:
                chosen = {"offset": round(aud[0], 4), "drift_ppm": pic["drift_ppm"], "method": "audio+picture",
                          "score": pic["r"], "cell": pic["cell"]}
            elif aud and aud[1] >= MIN_AUDIO_CONF:
                # Matching recorded waveforms are stronger timing evidence than
                # incidental motion (captions, gestures or a moving background).
                # A conflicting picture estimate cannot supply trustworthy drift.
                chosen = {"offset": round(aud[0], 4), "drift_ppm": 0.0, "method": "audio", "score": aud[1] / 100}
                if pic:
                    res["warning"] = (f"camera audio strongly matches at {aud[0]:+.2f}s, picture suggests {pic['offset']:+.2f}s; "
                                      "using the recorded audio match")
            elif pic:
                chosen = {"offset": pic["offset"], "drift_ppm": pic["drift_ppm"], "method": "picture",
                          "score": pic["r"], "cell": pic["cell"]}
                if aud:
                    res["warning"] = (f"camera audio says {aud[0]:+.2f}s, picture says {pic['offset']:+.2f}s; "
                                      "trusting the picture")
            elif aud and aud[1] >= 6:
                chosen = {"offset": round(aud[0], 4), "drift_ppm": 0.0, "method": "audio", "score": aud[1] / 100}
            if chosen:
                rate = 1 + chosen["drift_ppm"] / 1e6
                c0 = max(0.0, -chosen["offset"] / rate)
                c1 = min(cam["duration"], (mic["duration"] - chosen["offset"]) / rate)
                chosen["range"] = [round(c0, 3), round(c1, 3)]
                chosen["covers"] = max(0.0, c1 - c0) / cam["duration"] >= 0.5
            res["chosen"] = chosen
            results.append(res)
            if chosen and chosen["covers"] and (best is None or chosen["score"] > best[1]["score"]):
                best = (mic, chosen)
        if best:
            mic, ch = best
            cam["audio"] = {"source": mic["id"], "offset": ch["offset"], "drift_ppm": ch["drift_ppm"],
                            "range": ch["range"], "method": ch["method"]}
            if ch.get("cell"):
                cam["audio"]["mouth_cell"] = ch["cell"]
        else:
            cam.pop("audio", None)
    project.save(data)
    return results


def verify(project: Project, cam: dict, at: list[float], window: float = 30.0) -> list[dict]:
    """Independent check of a stored sync on stretches of source: does the
    speaker's mouth move with the synced mic, clearly more than at random
    offsets? A wrong sync stands out no more than chance (z near 0)."""
    audio = cam.get("audio")
    if not audio:
        return []
    mic = project.source(audio["source"])
    fps = cam.get("fps") or 25.0
    pad = 6.0                                     # seconds of mic either side, for chance levels
    out = []
    for t in at:
        span = min(window, cam["duration"])
        t0 = max(0.0, min(t - span / 2, cam["duration"] - span))
        cells = motion_cells(Path(cam["path"]), fps, t0, span)
        env = speech_envelope(Path(mic["path"]), fps, max(0.0, mic_time(audio, t0) - pad), span + 2 * pad)
        if len(cells) < 2 or len(env) < 2:
            out.append({"at": round(t0, 1), "r": 0.0, "frames": 0, "z": 0.0,
                        "inconclusive": True, "reason": "too little picture or audio to measure mouth/mic alignment"})
            continue
        base = int(round(min(pad, mic_time(audio, t0)) * fps))
        if audio.get("mouth_cell"):
            r0, c0 = audio["mouth_cell"]
            cand = [r0 * GRID_W + c0]
        else:
            cand = range(cells.shape[1])
        best = None
        for c in cand:
            m = _z(np.log(cells[:, c] + 1e-3))
            def score(d):
                seg = env[base + d:base + d + len(m)]
                return float((m * _z(seg)).mean()) if base + d >= 0 and len(seg) == len(m) else np.nan
            near = [score(d) for d in range(-4, 5)]
            far = [score(d) for d in list(range(-int(pad * fps), -int(1.5 * fps), 3)) + list(range(int(1.5 * fps), int(pad * fps), 3))]
            far = np.array([x for x in far if not np.isnan(x)])
            if not np.isfinite(near).any():
                continue
            j = int(np.nanargmax(near))
            z = (near[j] - far.mean()) / (far.std() + 1e-9) if len(far) > 5 else 0.0
            if best is None or z > best[2]:
                best = (near[j], j - 4, z, len(far) <= 5)
        if best is None:
            # Keep this a failed match: a stored offset with no overlapping
            # comparison window must not be mistaken for a successful check.
            out.append({"at": round(t0, 1), "r": 0.0, "frames": 0, "z": 0.0,
                        "reason": "the stored mic offset leaves no comparable audio window"})
            continue
        out.append({"at": round(t0, 1), "r": round(best[0], 3), "frames": best[1], "z": round(float(best[2]), 1)})
        if best[3]:
            out[-1].update(inconclusive=True, reason="the clip is too short for independent mouth/mic confidence comparisons")
    return out


def sync_screens(project: Project) -> list[dict]:
    """Screen recordings that captured the same voice line up with the camera by
    audio. Result on the screen source: sync = {"to": camera_id, "offset": s},
    screen_time = camera_time + offset."""
    data = project.load()
    cams = [s for s in data["sources"] if s["kind"] == "camera" and not s.get("skip")]
    screens = [s for s in data["sources"] if s["kind"] == "screen" and s.get("has_audio") and not s.get("skip")]
    results = []
    for scr in screens:
        if not camera_heard_speech(Path(scr["path"])):
            results.append({"screen": scr["id"], "chosen": None, "why": "no speech on the screen recording"})
            continue
        best = None
        for cam in cams:
            off, conf = audio_offset(Path(cam["path"]), Path(scr["path"]))
            overlap = min(cam["duration"], scr["duration"] - off) - max(0.0, -off)
            if conf >= MIN_AUDIO_CONF and overlap > 5 and (best is None or conf > best[2]):
                best = (cam, off, conf)
        if best:
            scr["sync"] = {"to": best[0]["id"], "offset": round(best[1], 4), "confidence": round(best[2], 1)}
        else:
            scr.pop("sync", None)
        results.append({"screen": scr["id"], "chosen": scr.get("sync")})
    project.save(data)
    return results
