"""`yap-machine doctor`: what's installed, what's missing, and how to get it.

Yap Machine doesn't bundle the heavy tools; it uses free local ones you may
already have. Everything here runs on your machine; nothing is uploaded.
"""

from __future__ import annotations

import shutil
import subprocess
import sys

from .transcribe import find_model


def _ok(cmd: list[str], needle: str | None = None) -> bool:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return out.returncode == 0 and (needle is None or needle in (out.stdout + out.stderr))


def checks() -> list[dict]:
    mac = sys.platform == "darwin"
    res = []

    def add(name, ok, why, fix, required=True):
        res.append({"name": name, "ok": ok, "why": why, "fix": fix, "required": required})

    add("Python 3.11+", sys.version_info >= (3, 11), "runs the engine", "install uv: https://docs.astral.sh/uv/")
    add("ffmpeg", bool(shutil.which("ffmpeg")), "cuts, renders, loudness",
        "brew install ffmpeg" if mac else "sudo apt install ffmpeg")
    from .visuals import person_matte_capability, studio_dir
    try:
        compositor = bool(shutil.which('node')) and (studio_dir() / 'node_modules/@remotion/renderer').is_dir()
    except Exception:
        compositor = False
    add("Caption renderer", _ok(["ffmpeg", "-hide_banner", "-filters"], " ass ") or compositor,
        "libass or the local styles compositor", "install the styles dependencies (npm ci --prefix studio), or an FFmpeg build with libass")
    add("whisper.cpp", bool(shutil.which("whisper-cli") or shutil.which("whisper-cpp")),
        "local transcription with word timings (Metal on Apple Silicon)",
        "brew install whisper-cpp" if mac else "build from https://github.com/ggml-org/whisper.cpp")
    try:
        model = find_model()
        add("Whisper model", True, f"found {model.name}", "")
    except Exception:
        add("Whisper model", False, "the speech model whisper.cpp reads",
            "mkdir -p ~/.cache/yap/models && curl -L -o ~/.cache/yap/models/ggml-medium.en.bin "
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin")
    try:
        import cv2  # noqa: F401
        cv = hasattr(cv2, "CascadeClassifier")
    except ImportError:
        cv = False
    add("OpenCV 4", cv, "face tracking for vertical shorts", "uv add 'opencv-python-headless<5'")
    bundled_inter = compositor and (studio_dir() / 'public/fonts/volt/Inter-400.woff2').is_file()
    add("Inter font", bundled_inter or _ok(["fc-match", "-f", "%{family}", "Inter"], "Inter"), "caption and name-card typeface",
        "brew install --cask font-inter" if mac else "https://rsms.me/inter/", required=False)
    add("Node 22.12+", _ok(["node", "-e", "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a<22 || (a===22 && b<12) ? 1 : 0)"]),
        "runs the desk and styles renderer", "https://nodejs.org or brew install node")
    add("Styles runtime", compositor, "renders style presets and effects", "run ./scripts/install from the repository folder")
    cutouts = person_matte_capability()
    add("Person cutouts", cutouts["available"], "optional automatic speaker cutouts",
        cutouts["reason"] or "", required=False)
    return res


def run() -> int:
    bad = 0
    for c in checks():
        mark = "✓" if c["ok"] else ("✗" if c["required"] else "·")
        print(f"  {mark} {c['name']:20} {c['why']}")
        if not c["ok"]:
            print(f"      → {c['fix']}")
            bad += c["required"]
    return 1 if bad else 0
