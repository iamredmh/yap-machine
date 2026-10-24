"""Scan a footage folder and register every usable file as a source."""

from __future__ import annotations

import fnmatch
import re
from pathlib import Path

from .media import AUDIO_EXT, IMAGE_EXT, VIDEO_EXT, probe
from .project import Project

SCREEN_HINTS = re.compile(r"screen|recording|capture|walkthrough|demo|zoom", re.I)


def classify(path: Path, info: dict) -> str:
    """camera = someone talking to camera; screen = screen recording / B-roll;
    audio = separate mic recording; image = still. The agent can re-label any
    source in project.json (`kind`) if the guess is wrong."""
    ext = path.suffix.lower()
    if ext in IMAGE_EXT:
        return "image"
    if not info.get("has_video"):
        return "audio" if info.get("has_audio") else "other"
    if SCREEN_HINTS.search(path.name) or SCREEN_HINTS.search(path.parent.name):
        return "screen"
    w, h = info.get("width") or 0, info.get("height") or 0
    if w and h:
        ratio = max(w, h) / min(w, h)
        standard = any(abs(ratio - r) / r < 0.01 for r in (16 / 9, 4 / 3, 1.0, 3 / 2, 1.85, 2.0, 2.39, 21 / 9))
        if not standard:
            return "screen"   # window / display captures have odd shapes (e.g. 3840×1976)
    if not info.get("has_audio"):
        return "broll"
    return "camera"


def make_id(path: Path, taken: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "-", path.stem).strip("-") or "src"
    base = base[:40]
    sid, n = base, 2
    while sid in taken:
        sid = f"{base}-{n}"
        n += 1
    taken.add(sid)
    return sid


def ingest(project: Project, footage: Path, exclude: list[str] | None = None) -> list[dict]:
    footage = footage.resolve()
    exclude = exclude or []
    data = project.load() if project.exists() else {"schema": 1}
    known = {s["path"]: s for s in data.get("sources", [])}
    taken = {s["id"] for s in known.values()}
    sources: list[dict] = []

    for path in sorted(footage.rglob("*")):
        if not path.is_file() or any(part.startswith(".") for part in path.relative_to(footage).parts):
            continue
        rel = str(path.relative_to(footage))
        if any(fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(path.name, pat) for pat in exclude):
            continue
        ext = path.suffix.lower()
        if ext not in VIDEO_EXT | AUDIO_EXT | IMAGE_EXT:
            continue
        key = str(path)
        if key in known:
            sources.append(known[key])
            continue
        info = {} if ext in IMAGE_EXT else probe(path)
        src = {
            "id": make_id(path, taken),
            "path": key,
            "rel": rel,
            "kind": classify(path, info),
            **info,
        }
        sources.append(src)

    data["footage"] = str(footage)
    data["sources"] = sources
    project.save(data)
    return sources
