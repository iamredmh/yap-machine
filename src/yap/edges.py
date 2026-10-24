"""Put a cut edge where the speech really starts or ends.

The engine places cuts from the transcript's word times. Whisper sometimes drops words (it
collapses a phrase said twice in a row) and often places a word 0.1 to 0.5 s early or late.
Then a cut lands inside speech: the first word is clipped, a stray fragment is left in, or
the last word is cut short.

The sound is the evidence, not the transcript. When loud sound runs on across a proposed edge
and the transcript has no words for it, the edge moves out to the quiet beyond the sound:

  * a stretch under half a second joined to the edge is the onset or tail of the word the
    edge belongs to, whose time is simply off, or a word the transcript lost: the edge moves
    out past it. No pitch test here: a word that starts with f, s, sh or th begins with hiss,
    which has none, and sound running unbroken into a cut is speech;
  * a longer stretch must also sound like speech (voiced: periodic pitch), so a cough or a
    chair doesn't pull the edge back;
  * the sound must sit clear of the neighbouring transcript word (0.15 s), so the tail of the
    previous word at a start, or the head of the next word at an end, is never taken in.

Whisper listens to the recovered stretch only to say what was in it, for the note. Whisper's
word times on a short slice are not good enough to decide anything.

Every move is reported with the words that were recovered, so nothing happens silently.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np

from .levels import SPEECH_RUN_COVERED, SPEECH_RUN_MIN, levels, speech_past_cut
from .project import Project, fmt_tc, read_json, write_json

LEAD = 0.03            # land this far outside the sound, in the quiet
SHORT_RUN = 0.5        # shorter than this is a word's own onset or tail, or a word or two the transcript lost
VOICED_MIN = 0.4       # a longer run must be at least this voiced to count as speech
NAME_RUN = 0.25        # from this length Whisper is asked what the sound was, for the note
NEIGHBOUR_GAP = 0.15   # the sound must be this far from the neighbouring transcript word
CONTEXT = 0.9          # seconds of known speech in the slice Whisper describes
PAD = 0.5              # seconds either side of the sound in that slice
MAX_MOVE = 1.0         # never move an edge further than this
MIN_P = 0.35
MIN_OVERLAP = 0.06

HALLUCINATIONS = {"you", "thank", "thanks", "bye", "okay", "so", "the", "uh", "um", "hmm", "mm"}

Samples = Callable[[float, float], np.ndarray]       # (start, end) in source seconds → 16 kHz mono floats
Transcribe = Callable[[float, float], list[dict]]    # (start, end) → words in source seconds


def voiced_share(x: np.ndarray, sr: int = 16000, win: float = 0.03, hop: float = 0.01) -> float:
    """Share of the sound that is voiced: frames with a clear periodic pitch (70-400 Hz), as speech
    has and clicks, typing and chair noise don't. 0 when there is nothing to measure."""
    n, h = int(win * sr), int(hop * sr)
    if len(x) < n:
        return 0.0
    peaks = []
    for i in range(0, len(x) - n + 1, h):
        f = x[i:i + n] - x[i:i + n].mean()
        e = float(np.dot(f, f))
        if e < 1e-7:
            continue
        ac = np.correlate(f, f, "full")[n - 1:]
        ac = ac / ac[0]
        peaks.append(float(ac[int(sr / 400):int(sr / 70)].max()))
    return float((np.array(peaks) > 0.5).mean()) if peaks else 0.0


def _alike(a: str, b: str) -> bool:
    from difflib import SequenceMatcher
    a, b = re.sub(r"[^a-z']", "", a.lower()), re.sub(r"[^a-z']", "", b.lower())
    return bool(a) and (a == b or SequenceMatcher(None, a, b).ratio() >= 0.75)


def real_words(words: list[dict], lo: float, hi: float, outside: dict | None = None) -> list[dict]:
    """The recovered words that overlap [lo, hi] and look like speech, for the note. `outside` is the
    neighbouring transcript word beyond the edge, which is the cut's business and not a missing word."""
    out = []
    for w in words:
        overlap = min(w["end"], hi) - max(w["start"], lo)
        text = re.sub(r"[^A-Za-z']", "", w["text"]).lower()
        if overlap < min(MIN_OVERLAP, 0.5 * (w["end"] - w["start"])) or w.get("p", 1.0) < MIN_P or len(text) < 2:
            continue
        if outside and _alike(w["text"], outside["text"]) and abs((w["start"] + w["end"]) / 2 - (outside["start"] + outside["end"]) / 2) < 0.7:
            continue
        out.append(w)
    if len(out) == 1 and re.sub(r"[^A-Za-z']", "", out[0]["text"]).lower() in HALLUCINATIONS:
        return []
    return out


def settle_edge(env: np.ndarray, words: list[dict], t: float, side: str, lo: float, hi: float,
                samples: Samples, transcribe: Transcribe | None = None, outside: dict | None = None) -> dict | None:
    """Decide whether one edge should move. Returns None to leave it, or
    {"t": new edge, "old": t, "run": seconds of sound, "voiced": share, "words": [recovered words]}.

    `lo`/`hi` bound the move (the neighbouring words); `outside` is the neighbouring transcript word beyond the edge."""
    loud = levels(env)[1] - 15
    run, stop, covered = speech_past_cut(env, words, t, side, loud)
    if run < SPEECH_RUN_MIN or covered >= SPEECH_RUN_COVERED or run > MAX_MOVE:
        return None
    if outside is not None:
        # the sound must be clear of the neighbouring word, or it is that word's own tail or head
        if side == "start" and stop < outside["end"] + NEIGHBOUR_GAP:
            return None
        if side == "end" and stop > outside["start"] - NEIGHBOUR_GAP:
            return None
    voiced = voiced_share(samples(min(t, stop), max(t, stop)))
    if run >= SHORT_RUN and voiced < VOICED_MIN:
        return None
    new = max(lo, stop - LEAD) if side == "start" else min(hi, stop + LEAD)
    if abs(new - t) < 0.02:
        return None
    got: list[dict] = []
    if transcribe is not None and run >= NAME_RUN:
        a, b = (stop - PAD, t + CONTEXT) if side == "start" else (t - CONTEXT, stop + PAD)
        try:
            got = real_words(transcribe(max(0.0, a), b), min(t, stop), max(t, stop), outside)
        except Exception:                      # naming the words is a courtesy; the move does not depend on it
            got = []
    return {"t": round(new, 4), "old": t, "run": round(run, 3), "voiced": round(voiced, 2), "words": got}


def describe(side: str, fix: dict, label: str) -> str:
    said = " ".join(w["text"] for w in fix["words"])
    what = f"speech (\"{said}\")" if said else "sound"
    return (f"moved the {side} of {label} from {fmt_tc(fix['old'])} to {fmt_tc(fix['t'])}: {fix['run']:.2f}s of {what} "
            f"ran across it and wasn't in the transcript")


def _program_wav(project: Project, src: dict) -> Path | None:
    """The source's program audio (16 kHz mono) kept in the project cache, about 2 MB a minute."""
    from .transcribe import program_audio_cmd
    wav = project.root / "cache" / f"{src['id']}.program.wav"
    if not wav.exists():
        wav.parent.mkdir(parents=True, exist_ok=True)
        r = subprocess.run(program_audio_cmd(project, src, wav), capture_output=True, text=True)
        if r.returncode != 0:
            return None
    return wav


def sample_reader(project: Project, src: dict) -> Samples:
    def read(a: float, b: float) -> np.ndarray:
        wav = _program_wav(project, src)
        if wav is None or b <= a:
            return np.zeros(0, np.float32)
        pr = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, a):.3f}", "-t", f"{b - a:.3f}", "-i", str(wav),
                             "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True)
        return np.frombuffer(pr.stdout, np.float32)
    return read


def slice_transcriber(project: Project, src: dict, model: str | None = None) -> Transcribe:
    """Whisper on a stretch of the source, cached in the project so re-resolving costs nothing."""
    from .transcribe import find_model, whisper_words
    cache_path = project.root / "cache" / f"{src['id']}.edges.json"
    cache = read_json(cache_path) if cache_path.exists() else {}

    def run(a: float, b: float) -> list[dict]:
        key = f"{a:.2f}-{b:.2f}"
        if key in cache:
            return cache[key]
        wav = _program_wav(project, src)
        if wav is None:
            return []
        with tempfile.TemporaryDirectory() as td:
            cut = Path(td) / "cut.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(wav), "-ac", "1",
                            "-ar", "16000", "-c:a", "pcm_s16le", str(cut)], capture_output=True)
            words, _ = whisper_words(cut, find_model(model), "", f"{src['id']} {a:.1f}s", verbatim=False)
        out = [{**w, "start": round(w["start"] + a, 3), "end": round(w["end"] + a, 3)} for w in words]
        cache[key] = out
        write_json(cache_path, cache)
        return out

    return run
