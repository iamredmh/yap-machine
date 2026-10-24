"""Speech levels from the program audio: where the speaker is actually talking.

Word timings from Whisper can stretch across pauses, so anything that needs to
know about silence (tightening pauses, dead-air checks, quiet takes) asks the
audio, not the transcript.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .media import load_audio, rms_envelope
from .project import Project, YapError
from .transcribe import program_audio_cmd

ENV_HOP = 0.01  # seconds per envelope frame


def envelope(project: Project, src: dict) -> np.ndarray:
    """10 ms RMS envelope (dBFS) of the source's program audio, cached."""
    cache = project.root / "cache" / f"{src['id']}.env.npy"
    if cache.exists():
        return np.load(cache)
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "a.wav"
        r = subprocess.run(program_audio_cmd(project, src, wav), capture_output=True, text=True)
        if r.returncode != 0:
            raise YapError(f"audio extract failed for {src['id']}: {r.stderr[-400:]}")
        env = rms_envelope(load_audio(wav, 16000), 16000, hop=ENV_HOP)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.save(cache, env)
    return env


def levels(env: np.ndarray) -> tuple[float, float, float]:
    """(noise floor, typical speech level, silence threshold) in dBFS."""
    floor = float(np.percentile(env, 10))
    loud = env[env > floor + 20]
    speech = float(np.median(loud)) if len(loud) else floor + 30
    thresh = floor + 0.35 * (speech - floor)
    return floor, speech, thresh


def silences(env: np.ndarray, t0: float, t1: float, min_len: float, thresh: float) -> list[tuple[float, float]]:
    """Silent stretches of at least min_len seconds inside [t0, t1]."""
    i0, i1 = max(0, int(t0 / ENV_HOP)), min(len(env), int(t1 / ENV_HOP))
    quiet = env[i0:i1] < thresh
    out: list[tuple[float, float]] = []
    start = None
    for k, q in enumerate(quiet):
        if q and start is None:
            start = k
        elif not q and start is not None:
            if (k - start) * ENV_HOP >= min_len:
                out.append(((i0 + start) * ENV_HOP, (i0 + k) * ENV_HOP))
            start = None
    if start is not None and (len(quiet) - start) * ENV_HOP >= min_len:
        out.append(((i0 + start) * ENV_HOP, i1 * ENV_HOP))
    return out


def phrase_level(env: np.ndarray, t0: float, t1: float, thresh: float) -> float | None:
    """Median level of the voiced frames in [t0, t1]."""
    seg = env[max(0, int(t0 / ENV_HOP)):int(t1 / ENV_HOP)]
    voiced = seg[seg > thresh]
    return float(np.median(voiced)) if len(voiced) else None


SPEECH_RUN_MIN = 0.10       # sound running this far past a cut is speech, not a word's tail
SPEECH_RUN_COVERED = 0.25   # ...and it is unexplained when the transcript's words cover less than this of it


def speech_past_cut(env: np.ndarray, words: list[dict], t: float, side: str, loud: float, gap_ok: float = 0.03,
                    max_run: float = 1.5) -> tuple[float, float, float]:
    """How far loud sound runs *outside* a cut, and how much of it the transcript explains.

    Outside means before a segment's start or after its end: sound running on across the edge
    means the cut slices through speech. Returns (run length, where the sound stops, share of
    that stretch covered by transcript words). A run of 0.1 s or more that the transcript has no
    words for means the word timings are off here, or words were dropped (Whisper collapses a
    phrase said twice in a row), and the cut will clip or leak words."""
    hop = ENV_HOP
    step = -1 if side == "start" else 1
    i = int((t - 0.005) / hop) if side == "start" else int((t + 0.005) / hop)
    dip, last, n = 0, None, 0
    while 0 <= i < len(env) and n * hop <= max_run:
        if env[i] > loud:
            last, dip = i, 0
        else:
            dip += 1
            if dip * hop > gap_ok:
                break
        i += step
        n += 1
    if last is None:
        return 0.0, t, 1.0
    edge = last * hop
    lo, hi = min(t, edge), max(t, edge)
    covered = sum(max(0.0, min(w["end"], hi) - max(w["start"], lo)) for w in words) / max(hi - lo, 1e-6)
    return abs(t - edge), edge, covered
