"""Word-level transcripts, one per talking-head source, in that source's time.

Providers:
  whispercpp  (default) local whisper.cpp via `whisper-cli`, Metal on Apple Silicon
  import      bring your own: a JSON file of words [{text,start,end}] or an SRT

Output (transcripts/<id>.json):
  {"source": id, "provider": ..., "model": ..., "words": [{"text","start","end","p"}]}
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .project import Project, YapError, write_json

# Nudges Whisper towards verbatim output so ums, uhs and restarts survive.
VERBATIM_PROMPT = "Um, so, uh, I think, like, you know, we- we're gonna, hmm, okay."

MODEL_DIRS = [
    Path(os.environ.get("YAP_MODELS", "~/.cache/yap/models")).expanduser(),
    Path("~/.cache/hyperframes/whisper/models").expanduser(),
    Path("/opt/homebrew/share/whisper-cpp"),
    Path("/usr/local/share/whisper-cpp"),
    Path("~/Library/Application Support/Elgato/VoiceSync/Model").expanduser(),
]
MODEL_PREFERENCE = ["ggml-large-v3-turbo.bin", "ggml-medium.en.bin", "ggml-medium.bin",
                    "ggml-small.en.bin", "ggml-small.bin", "ggml-base.en.bin", "ggml-base.bin",
                    "ggml-tiny.en.bin", "ggml-tiny.bin"]


def find_model(explicit: str | None = None) -> Path:
    if explicit:
        p = Path(explicit).expanduser()
        if p.exists():
            return p
        raise YapError(f"model not found: {p}")
    env = os.environ.get("YAP_WHISPER_MODEL")
    if env and Path(env).expanduser().exists():
        return Path(env).expanduser()
    for name in MODEL_PREFERENCE:
        for d in MODEL_DIRS:
            if (d / name).exists():
                return d / name
    raise YapError(
        "no whisper.cpp model found. Download one, e.g.\n"
        "  mkdir -p ~/.cache/yap/models && curl -L -o ~/.cache/yap/models/ggml-medium.en.bin "
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin"
    )


def dtw_preset(model: Path) -> str | None:
    """whisper.cpp alignment-head preset for a model file, for DTW word timing."""
    name = model.name.removeprefix("ggml-").removesuffix(".bin")
    name = re.sub(r"-q\d.*$", "", name)          # quantised variants share heads
    name = name.replace("large-v3-turbo", "large.v3.turbo").replace("large-v", "large.v")
    known = {"tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
             "large.v1", "large.v2", "large.v3", "large.v3.turbo"}
    return name if name in known else None


def tokens_to_words(segments: list[dict]) -> list[dict]:
    """Merge whisper.cpp tokens into words. A token starting with a space opens
    a new word; punctuation and sub-word pieces attach to the current one.

    Word starts come from DTW timing (`t_dtw`, centiseconds) when present: the
    plain token offsets drift by seconds over long recordings. Ends are rough
    here and get refined against the audio in `refine_ends`."""
    words: list[dict] = []
    for seg in segments:
        for tok in seg.get("tokens", []):
            text = tok.get("text", "")
            if text.startswith("[_") or text.startswith("<|"):
                continue
            dtw = tok.get("t_dtw", -1)
            t0 = dtw / 100.0 if dtw is not None and dtw >= 0 else tok["offsets"]["from"] / 1000.0
            p = float(tok.get("p", 1.0))
            starts_word = text.startswith(" ") or not words
            is_punct = bool(re.fullmatch(r"\s*[^\w\s]+\s*", text))
            if starts_word and not is_punct:
                words.append({"text": text.strip(), "start": t0, "end": t0 + 0.2, "p": p})
            elif words:
                w = words[-1]
                w["text"] += text.strip()
                if not is_punct:
                    w["p"] = min(w["p"], p)
    # keep starts in order (DTW can wobble by a frame)
    for i in range(1, len(words)):
        words[i]["start"] = max(words[i]["start"], words[i - 1]["start"] + 0.01)
    return [w for w in words if w["text"]]


def refine_ends(words: list[dict], env, hop: float, thresh: float, max_gap: float = 0.25) -> None:
    """A word ends where its sound stops: walk forward from the word's start
    and stop at the first gap longer than max_gap (breaths and room noise
    after a word don't count as part of it)."""
    for i, w in enumerate(words):
        nxt = words[i + 1]["start"] if i + 1 < len(words) else w["start"] + 1.5
        a = int(w["start"] / hop)
        b = max(a + 1, min(len(env), int(nxt / hop)))
        last, quiet = None, 0
        for k in range(a, b):
            if env[k] > thresh:
                last, quiet = k, 0
            else:
                quiet += 1
                if last is not None and quiet * hop > max_gap:
                    break
                if last is None and quiet * hop > 0.4:
                    break  # never found the word's sound; leave a short span
        end = (last + 1) * hop + 0.02 if last is not None else w["start"] + 0.08
        w["end"] = round(min(max(end, w["start"] + 0.05), max(nxt, w["start"] + 0.05)), 3)
        w["start"] = round(w["start"], 3)
        w["p"] = round(w["p"], 3)
        if last is None:
            w["unvoiced"] = True
    # DTW often places the first or last word of a sentence in the silence
    # beside it. Move such words onto the speech they belong to.
    for i, w in enumerate(words):
        if not w.pop("unvoiced", False):
            continue
        prev = words[i - 1] if i > 0 else None
        nxt = words[i + 1] if i + 1 < len(words) else None
        gap_before = w["start"] - prev["end"] if prev else 1e9
        gap_after = nxt["start"] - w["start"] if nxt else 1e9
        if prev and gap_before <= gap_after:
            w["start"] = round(max(prev["start"], prev["end"] - 0.12), 3)
            w["end"] = prev["end"]
        elif nxt:
            w["start"] = round(max(w["start"], nxt["start"] - 0.25), 3)
            w["end"] = round(nxt["start"], 3)
        w["moved"] = True


def program_audio_cmd(project: Project, src: dict, out_wav: Path) -> list[str]:
    """16 kHz mono WAV of what the source *sounds like* in the edit, in the
    source's own time: the synced mic where it covers, camera audio elsewhere.
    Clock drift between the devices is corrected with a tiny tempo change."""
    from .sync import mic_time
    audio = src.get("audio")
    base = ["ffmpeg", "-v", "error", "-y", "-nostdin"]
    tail = ["-ac", "1", "-c:a", "pcm_s16le", str(out_wav)]
    if not audio:
        return base + ["-i", src["path"], "-vn", "-ar", "16000"] + tail
    mic = project.source(audio["source"])
    c0, c1 = audio.get("range", [0.0, src["duration"]])
    rate = 1 + audio.get("drift_ppm", 0.0) / 1e6
    fmt = "aresample=16000,aformat=channel_layouts=mono"
    parts, labels = [], []
    if c0 > 0.001:
        parts.append(f"[0:a]atrim=0:{c0:.4f},asetpts=PTS-STARTPTS,{fmt}[a0]")
        labels.append("[a0]")
    tempo = f"atempo={rate:.8f}," if abs(rate - 1) > 1e-6 else ""
    parts.append(f"[1:a]atrim={mic_time(audio, c0):.4f}:{mic_time(audio, c1):.4f},asetpts=PTS-STARTPTS,"
                 f"{tempo}{fmt}[a1]")
    labels.append("[a1]")
    if c1 < src["duration"] - 0.001:
        parts.append(f"[0:a]atrim={c1:.4f},asetpts=PTS-STARTPTS,{fmt}[a2]")
        labels.append("[a2]")
    parts.append(f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1[out]")
    return base + ["-i", src["path"], "-i", mic["path"], "-filter_complex", ";".join(parts),
                   "-map", "[out]", "-ar", "16000"] + tail


def whisper_words(wav: Path, model: Path, prompt: str, label: str, verbatim: bool = True) -> tuple[list[dict], dict]:
    """Run whisper.cpp on a 16 kHz mono WAV and return (words with timing, raw result).
    Used for sources and for re-listening to a rendered cut."""
    exe = shutil.which("whisper-cli") or shutil.which("whisper-cpp")
    if not exe:
        raise YapError("whisper-cli not found. Install whisper.cpp (macOS: `brew install whisper-cpp`).")
    with tempfile.TemporaryDirectory() as td:
        base = Path(td) / "out"
        cmd = [exe, "-m", str(model), "-f", str(wav), "-ojf", "-of", str(base), "-np"]
        if verbatim:
            cmd += ["--prompt", prompt]
        preset = dtw_preset(model)
        if preset:
            cmd += ["-dtw", preset, "-nfa"]  # DTW needs flash attention off
        lang = "en" if model.name.endswith(".en.bin") else "auto"
        cmd += ["-l", lang]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode and any(tag in r.stderr.lower() for tag in ('ggml_metal', 'metal device', 'gpu')):
            # Headless Macs may have whisper.cpp but no available Metal device.
            # Reuse the installed model on CPU instead of requiring a setup change.
            r = subprocess.run([*cmd, '-ng'], capture_output=True, text=True)
        if r.returncode != 0:
            raise YapError(f"whisper-cli failed for {label}: {r.stderr[-800:]}")
        data = json.loads((base.with_suffix(".json")).read_text())
        from .levels import ENV_HOP, levels
        from .media import load_audio, rms_envelope
        env = rms_envelope(load_audio(wav, 16000), 16000, hop=ENV_HOP)
    words = tokens_to_words(data.get("transcription", []))
    floor, speech, _ = levels(env)
    refine_ends(words, env, ENV_HOP, floor + 0.5 * (speech - floor))
    return words, {**data, "timing": "dtw" if preset else "tokens"}


def transcribe_whispercpp(project: Project, src: dict, model: Path) -> dict:
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "audio.wav"
        r = subprocess.run(program_audio_cmd(project, src, wav), capture_output=True, text=True)
        if r.returncode != 0:
            raise YapError(f"audio extract failed for {src['id']}: {r.stderr[-500:]}")
        # names from style.json "spellings" nudge Whisper towards the right words
        from .overlays import load_style
        names = ", ".join(sorted(set(load_style(project).get("spellings", {}).values())))
        prompt = f"{VERBATIM_PROMPT} {names}." if names else VERBATIM_PROMPT
        words, data = whisper_words(wav, model, prompt, src["id"])
    preset = data["timing"] == "dtw"
    return {
        "source": src["id"],
        "provider": "whispercpp",
        "model": model.name,
        "language": data.get("result", {}).get("language"),
        "audio": "mic" if src.get("audio") else "camera",
        "timing": "dtw" if preset else "tokens",
        "words": words,
    }


def _srt_seconds(ts: str) -> float:
    h, m, rest = ts.strip().replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def import_transcript(src: dict, path: Path) -> dict:
    """Bring-your-own transcript. Word JSON keeps word timing; SRT/VTT cues are
    spread evenly across their words (coarser cuts — prefer word JSON)."""
    text = path.read_text()
    words: list[dict] = []
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        items = data.get("words", data) if isinstance(data, dict) else data
        for w in items:
            t = (w.get("text") or w.get("word") or "").strip()
            if t and w.get("start") is not None:
                words.append({"text": t, "start": float(w["start"]), "end": float(w.get("end", w["start"])),
                              "p": float(w.get("p", w.get("probability", 1.0)))})
    else:
        for block in re.split(r"\n\s*\n", text):
            m = re.search(r"(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)", block)
            if not m:
                continue
            a, b = _srt_seconds(m.group(1)), _srt_seconds(m.group(2))
            cue = " ".join(block[m.end():].split())
            toks = cue.split()
            step = (b - a) / max(1, len(toks))
            for i, t in enumerate(toks):
                words.append({"text": t, "start": round(a + i * step, 3), "end": round(a + (i + 1) * step, 3), "p": 1.0})
    if not words:
        raise YapError(f"no words found in {path}")
    return {"source": src["id"], "provider": "import", "model": path.name, "words": words}


def transcribe(project: Project, only: list[str] | None = None, model: str | None = None,
               force: bool = False) -> list[str]:
    done = []
    mpath = find_model(model)
    for src in project.talking_sources():
        if only and src["id"] not in only:
            continue
        out = project.transcript_path(src["id"])
        if out.exists() and not force:
            continue
        write_json(out, transcribe_whispercpp(project, src, mpath))
        done.append(src["id"])
    return done
