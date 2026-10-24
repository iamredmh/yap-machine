"""Project folder layout and JSON helpers.

A Yap Machine project is a plain folder. Source footage stays where it is;
the project only holds what we derive from it.

    <project>/
      project.json          footage dir, sources, sync offsets
      transcripts/<id>.json word-level transcript per talking-head source
      phrases.json          phrases with ids, flags (machine-readable)
      takes.md              the same, for the agent to read
      cuts/v1/edl.json      the agent's cut (written by the agent)
      cuts/v1/timeline.json the resolved cut (written by `yap-machine resolve`)
      cuts/v1/qc.md         automated checks (written by `yap-machine check`)
      cuts/v2/shorts/s1/    a short cut from v2 (version name "v2.s1"), same files
      renders/v1.mp4        renders/v2.s1.mp4 for shorts
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

PROJECT_FILE = "project.json"


class YapError(Exception):
    pass


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


class Project:
    def __init__(self, root: Path):
        self.root = root.resolve()

    @property
    def file(self) -> Path:
        return self.root / PROJECT_FILE

    def exists(self) -> bool:
        return self.file.exists()

    def load(self) -> dict:
        if not self.exists():
            raise YapError(f"no Yap Machine project at {self.root} (run `yap-machine init` first)")
        return read_json(self.file)

    def save(self, data: dict) -> None:
        write_json(self.file, data)

    def sources(self) -> list[dict]:
        return self.load().get("sources", [])

    def source(self, source_id: str) -> dict:
        for s in self.sources():
            if s["id"] == source_id:
                return s
        raise YapError(f"unknown source '{source_id}'")

    def talking_sources(self) -> list[dict]:
        return [s for s in self.sources() if s["kind"] == "camera" and not s.get("skip")]

    def transcript_path(self, source_id: str) -> Path:
        return self.root / "transcripts" / f"{source_id}.json"

    def cut_dir(self, version: str) -> Path:
        v = normalise_version(version)
        if "." in v:                          # a short: v2.s1 → cuts/v2/shorts/s1
            parent, short = v.split(".")
            return self.root / "cuts" / parent / "shorts" / short
        return self.root / "cuts" / v

    def render_path(self, version: str, draft: bool = False, lang: str | None = None) -> Path:
        v = normalise_version(version) + (f".{lang}" if lang else "")
        return self.root / "renders" / (f"{v}-draft.mp4" if draft else f"{v}.mp4")

    def versions(self) -> list[str]:
        d = self.root / "cuts"
        if not d.is_dir():
            return []
        vs = [p.name for p in d.iterdir() if re.fullmatch(r"v\d+", p.name)]
        return sorted(vs, key=lambda v: int(v[1:]))


def normalise_version(v: str) -> str:
    v = str(v).strip().lower()
    if v.isdigit():
        v = f"v{v}"
    if not re.fullmatch(r"v\d+(\.s\d+)?", v):
        raise YapError(f"bad version '{v}' (expected v1, v2, … or a short like v2.s1)")
    return v


def tool_fix(name: str) -> str:
    """How to get a missing program, in the words `yap-machine doctor` uses."""
    import sys
    mac = sys.platform == "darwin"
    if name in ("ffmpeg", "ffprobe"):
        return "brew install ffmpeg" if mac else "sudo apt install ffmpeg"
    if name in ("whisper-cli", "whisper-cpp"):
        return "brew install whisper-cpp" if mac else "build from https://github.com/ggml-org/whisper.cpp"
    if name == "tesseract":
        return "brew install tesseract" if mac else "sudo apt install tesseract-ocr"
    return f"install {name}"


def missing_tool_error(name: str) -> "YapError":
    return YapError(f"`{name}` isn't installed, and Yap Machine needs it. Install it with: {tool_fix(name)}\n"
                    f"Run `yap-machine doctor` to see everything Yap Machine uses and what is missing.")


def require_tools(*names: str) -> None:
    """Fail early, with the install line, when a program Yap Machine shells out to isn't there."""
    import shutil
    absent = [n for n in names if not shutil.which(n)]
    if absent:
        lines = [f"{n}: {tool_fix(n)}" for n in absent]
        raise YapError(f"missing: {', '.join(absent)}. Install with\n  " + "\n  ".join(lines)
                       + "\nRun `yap-machine doctor` to see everything Yap Machine uses and what is missing.")


def run(cmd: list[str], *, capture: bool = True) -> subprocess.CompletedProcess:
    try:
        proc = subprocess.run(cmd, capture_output=capture, text=True)
    except FileNotFoundError as e:
        raise missing_tool_error(Path(str(e.filename or cmd[0])).name) from e
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-1500:]
        raise YapError(f"command failed: {' '.join(cmd[:4])} …\n{tail}")
    return proc


def fmt_tc(seconds: float) -> str:
    """mm:ss.ss for humans."""
    m, s = divmod(max(0.0, seconds), 60)
    return f"{int(m):02d}:{s:05.2f}"
