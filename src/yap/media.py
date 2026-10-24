"""ffprobe / ffmpeg helpers."""

from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from pathlib import Path

import numpy as np

from .project import YapError, run

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".mxf", ".avi", ".webm"}
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".aif", ".aiff"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".heic", ".gif"}


def probe(path: Path) -> dict:
    out = run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]).stdout
    data = json.loads(out)
    info: dict = {
        "duration": float(data.get("format", {}).get("duration", 0) or 0),
        "has_video": False,
        "has_audio": False,
    }
    for st in data.get("streams", []):
        if st.get("codec_type") == "video" and not info["has_video"]:
            if st.get("disposition", {}).get("attached_pic"):
                continue
            info["has_video"] = True
            info["width"] = st.get("width")
            info["height"] = st.get("height")
            info["video_codec"] = st.get("codec_name")
            info["pix_fmt"] = st.get("pix_fmt")
            info["color_transfer"] = st.get("color_transfer")
            rate = st.get("avg_frame_rate") or st.get("r_frame_rate") or "0/1"
            try:
                info["fps"] = round(float(Fraction(rate)), 3)
            except (ZeroDivisionError, ValueError):
                info["fps"] = None
            rot = 0
            for sd in st.get("side_data_list", []) or []:
                if "rotation" in sd:
                    rot = int(sd["rotation"])
            info["rotation"] = rot
        elif st.get("codec_type") == "audio" and not info["has_audio"]:
            info["has_audio"] = True
            info["audio_codec"] = st.get("codec_name")
            info["sample_rate"] = int(st.get("sample_rate", 0) or 0)
            info["channels"] = st.get("channels")
    tags = data.get("format", {}).get("tags", {}) or {}
    if "creation_time" in tags:
        info["creation_time"] = tags["creation_time"]
    return info


def load_audio(path: Path, sr: int = 8000, start: float = 0.0, duration: float | None = None) -> np.ndarray:
    """Decode mono float32 audio via ffmpeg."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(path)]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise YapError(f"could not decode audio from {path}: {proc.stderr.decode()[-500:]}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def rms_envelope(audio: np.ndarray, sr: int, hop: float = 0.01, win: float = 0.03) -> np.ndarray:
    """RMS in dBFS every `hop` seconds."""
    h = max(1, int(sr * hop))
    w = max(h, int(sr * win))
    n = max(0, (len(audio) - w) // h + 1)
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    idx = np.arange(w)[None, :] + h * np.arange(n)[:, None]
    frames = audio[idx]
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)
    return (20 * np.log10(rms)).astype(np.float32)
