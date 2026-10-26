"""Styles and timed effects over the resolved cut. All times are output times.

The original cut stays editable. The desk saves visuals.json per cut, and a
styled export is a separate render. No footage leaves this computer.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .project import Project, YapError, read_json, run, write_json


def studio_dir() -> Path:
    override = os.environ.get("YAP_STUDIO")
    candidates = [Path(override)] if override else []
    candidates += [Path(__file__).resolve().parents[2] / "studio", Path(__file__).parent / "visual-studio"]
    for p in candidates:
        if (p / "catalog.json").is_file():
            return p
    raise YapError("The styles renderer is missing. Reinstall Yap Machine from the complete source package.")


def catalog() -> dict:
    return read_json(studio_dir() / "catalog.json")


def finite(value, label: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not lo <= value <= hi:
        raise YapError(f"{label} must be a number between {lo:g} and {hi:g}")
    return float(value)


def asset_path(project: Project, rel: str) -> Path:
    if not isinstance(rel, str) or not rel or Path(rel).is_absolute():
        raise YapError("Choose an uploaded image or video for this effect")
    path = (project.root / rel).resolve()
    if not path.is_relative_to(project.root) or not path.is_file():
        raise YapError(f"Effect asset isn't available in this project: {rel}")
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".webm", ".m4v"}:
        raise YapError("Effect assets must be PNG, JPEG, WebP, MP4, MOV or WebM")
    return path


def anchor_time(effect: dict, timeline: dict, project: Project) -> float:
    """Stable source anchor survives trims/reorders. Never fall back to stale seconds."""
    anchor = effect.get("anchor")
    if anchor:
        if not isinstance(anchor, dict) or not isinstance(anchor.get("source"), str):
            raise YapError("Effect anchor needs a source and source time")
        at = finite(anchor.get("time"), "Anchor time", 0, 1e9)
        matches = [s for s in timeline["segments"] if s["source"] == anchor["source"] and s["start"] <= at < s["end"]]
        occurrence = anchor.get("occurrence", 0)
        if isinstance(occurrence, bool) or not isinstance(occurrence, int) or not 0 <= occurrence < len(matches):
            raise YapError(f"Effect '{effect.get('type')}' targets footage removed from this cut. Place it again.")
        s = matches[occurrence]
        return at - s["start"] + s["out_start"]
    at = effect.get("at", 0)
    if isinstance(at, str):
        if not re.fullmatch(r"P\d+", at):
            raise YapError("Effect start must be a number or a phrase id such as P001")
        from .overlays import _phrase_time
        try:
            return _phrase_time(project, timeline, at)
        except FileNotFoundError as exc:
            raise YapError("This cut has no phrase timings. Place the effect in seconds instead.") from exc
    return finite(at, "Effect start", 0, timeline["duration"])


def validate(project: Project, timeline: dict, config: dict) -> dict:
    if not isinstance(config, dict):
        raise YapError("Visual settings must be an object")
    cat = catalog()
    pack = config.get("preset", "original")
    if pack not in ["original", *[s["id"] for s in cat["styles"]]]:
        raise YapError(f"Unknown style: {pack}")
    motion = config.get("motion", "balanced")
    if not isinstance(motion, str) or motion not in {"subtle", "balanced", "bold"}:
        raise YapError("Choose Subtle, Balanced or Bold motion")
    if config.get("accent") and (not isinstance(config['accent'], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", config["accent"])):
        raise YapError("Accent must be a six-digit hex colour")
    rows = config.get("effects", [])
    if not isinstance(rows, list) or len(rows) > 100:
        raise YapError("A cut can have up to 100 effects")
    types = {e["id"]: e for e in cat["effects"]}
    resolved, seen = [], set()
    for i, effect in enumerate(rows):
        if not isinstance(effect, dict) or effect.get("type") not in types:
            raise YapError(f"Effect {i + 1}: choose a known effect")
        e = copy.deepcopy(effect)
        eid = e.get("id", f"effect-{i + 1}")
        if not isinstance(eid, str) or not re.fullmatch(r"[\w-]{1,80}", eid) or eid in seen:
            raise YapError("Each effect needs a unique id")
        seen.add(eid)
        e["id"] = eid
        if e.get("enabled", True) is not True and e.get("enabled") is not False:
            raise YapError("Effect enabled must be true or false")
        e["at"] = anchor_time(e, timeline, project)
        e["duration"] = finite(e.get("duration", 2.5), "Effect duration", .1, 60)
        e["strength"] = finite(e.get("strength", 1), "Effect strength", .25, 2)
        if e["at"] >= timeline["duration"] or e["at"] + e["duration"] > timeline["duration"] + .001:
            raise YapError(f"{types[e['type']]['name']} runs past the end of the cut")
        if not isinstance(e.get("text", ""), str) or len(e.get("text", "")) > 180:
            raise YapError("Effect text must be at most 180 characters")
        if "textSize" in e or e["type"] == "text-behind-person":
            e["textSize"] = finite(e.get("textSize", .16), "Text size", .06, .3)
        if "textY" in e or e["type"] == "text-behind-person":
            e["textY"] = finite(e.get("textY", .3), "Text position", .1, .85)
        if e["type"] == "text-behind-person" and e.get("enabled", True) and not e.get("text", "").strip():
            raise YapError("Add the words you want to place behind you")
        items = e.get("items", [])
        if not isinstance(items, list) or len(items) > 8 or any(not isinstance(x, str) or not x.strip() or len(x) > 80 for x in items):
            raise YapError("Use up to eight short, nonempty checklist items or headlines")
        values = e.get("values", [])
        if not isinstance(values, list) or len(values) > 12:
            raise YapError("A growth curve takes 2–12 values")
        for value in values:
            finite(value, "Chart value", -1e12, 1e12)
        if e["type"] == "growth-curve" and e.get("enabled", True) and len(values) < 2:
            raise YapError("Add at least two real values for the growth curve")
        if e["type"] == "count-up" and e.get("enabled", True) and len(values) != 2:
            raise YapError("Count up needs exactly two numbers: a starting value and your total")
        if e["type"] in {"checklist", "checklist-pop", "headline-storm"} and e.get("enabled", True) and not items:
            raise YapError("Add the words you want this effect to show")
        if types[e["type"]]["asset"] and e.get("enabled", True):
            asset_path(project, e.get("asset", ""))
        if e["type"] == "zoom-through-cut" and e.get("enabled", True):
            joins = [s["out_start"] for s in timeline["segments"][1:]
                     if e["at"] <= s["out_start"] < e["at"] + e["duration"]]
            if not joins:
                raise YapError("Place Zoom through cut across an edit boundary")
            e["joinAt"] = min(joins, key=lambda t: abs(t - e["at"] - e["duration"] / 2))
        resolved.append(e)
    return {**config, "schema": 1, "preset": pack, "motion": motion, "effects": resolved}


def load_config(project: Project, version: str, timeline: dict) -> dict:
    path = project.cut_dir(version) / "visuals.json"
    cfg = read_json(path) if path.exists() else {}
    style = read_json(project.root / "style.json") if (project.root / "style.json").exists() else {}
    cfg = {"preset": style.get("visual_style", "original"), **style.get("visual_defaults", {}), **cfg}
    return validate(project, timeline, cfg)


def active(config: dict) -> bool:
    return config.get("preset", "original") != "original" or any(e.get("enabled", True) for e in config.get("effects", []))


def trim_timeline(timeline: dict, start: float, duration: float = 6) -> dict:
    stop = min(timeline["duration"], start + duration)
    tl = copy.deepcopy(timeline)
    segs = []
    for s in tl["segments"]:
        a, b = max(start, s["out_start"]), min(stop, s["out_end"])
        if b <= a:
            continue
        lead = a - s["out_start"]
        s["start"] += lead
        s["end"] = s["start"] + b - a
        if s.get("screen"):
            s["screen"]["start"] += lead
        s["out_start"], s["out_end"] = a - start, b - start
        segs.append(s)
    tl["segments"], tl["duration"] = segs, stop - start
    return tl


def face_measurements(plate: Path, width: int, height: int) -> dict:
    import cv2
    from .reframe import _detector
    cap = cv2.VideoCapture(str(plate))
    cap.set(cv2.CAP_PROP_POS_MSEC, 400)
    ok, frame = cap.read()
    cap.release()
    x, y, fw, fh = width * .35, height * .24, width * .3, height * .25
    tone = .1
    if ok:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        found = _detector().detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
        if len(found):
            x, y, fw, fh = map(float, max(found, key=lambda f: f[2] * f[3]))
        patch = gray[int(min(height - 1, y + fh * 1.4)):int(min(height, y + fh * 2)), :]
        if patch.size:
            tone = float(patch.mean() / 255)
    return {"faceX": x + fw / 2, "crown": max(0, y - .5 * fh), "eyes": y + fh * .36,
            "chin": min(height, y + fh * 1.12), "tone": {"chest": tone}}


def person_matte_capability() -> dict:
    """Report native Vision support without starting a render or installing tools."""
    if sys.platform != "darwin":
        return {"available": False, "reason": "Automatic person cutouts need macOS 12 or later. Disable cutout effects to export on this computer; other effects and styles work here."}
    # VNGeneratePersonSegmentationRequest was introduced in macOS 12.
    version = platform.mac_ver()[0]
    if not version or int(version.split('.')[0]) < 12:
        return {"available": False, "reason": "Automatic person cutouts need macOS 12 or later. Update macOS or disable cutout effects to export."}
    try:
        # /usr/bin/swiftc is also present as a stub before the tools are installed.
        tools = subprocess.run(["/usr/bin/xcrun", "--find", "swiftc"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        tools = None
    if tools is None or tools.returncode != 0:
        return {"available": False, "reason": "Automatic person cutouts need Apple's Command Line Tools. Run xcode-select --install, then reopen Yap Machine."}
    return {"available": True, "reason": None}


def prepare_matte(plate: Path, work: Path, fps: float) -> dict:
    """Native, local person segmentation. Cache belongs to this immutable plate."""
    capability = person_matte_capability()
    if not capability['available']:
        raise YapError(capability['reason'])
    renderer = studio_dir()
    source = renderer / "person-mask.swift"
    cache = work.parent / "person-masks"
    cache.mkdir(parents=True, exist_ok=True)
    with plate.open('rb') as stream:
        key = hashlib.file_digest(stream, 'sha256').hexdigest()[:20]
    dest = cache / key
    if not (dest / "done.json").exists():
        dest.mkdir(exist_ok=True)
        frames = dest / "frames"
        masks = dest / "masks"
        frames.mkdir(exist_ok=True)
        masks.mkdir(exist_ok=True)
        sample_fps = min(15, fps)
        run(["ffmpeg", "-v", "error", "-y", "-i", str(plate), "-vf", f"fps={sample_fps},scale=512:-2", str(frames / "%06d.png")])
        binary = cache / ("person-mask-" + hashlib.sha256(source.read_bytes()).hexdigest()[:10])
        if not binary.exists():
            run(["swiftc", "-O", str(source), "-o", str(binary)])
        run([str(binary), str(frames), str(masks)])
        if not list(masks.glob("*.png")):
            raise YapError("No person masks could be produced for this footage")
        write_json(dest / "done.json", {"fps": sample_fps, "count": len(list(masks.glob('*.png')))})
        shutil.rmtree(frames, ignore_errors=True)
    return {"dir": str(dest / "masks"), **read_json(dest / "done.json")}


def visual_plan(project: Project, version: str, plate: Path, work: Path, timeline: dict, config: dict,
                edl: dict, draft: bool, offset: float = 0, lang: str | None = None) -> dict:
    from .overlays import load_style, output_words, resolve_caption_style, split_translation
    w, h = (540, 960) if draft and timeline["height"] > timeline["width"] else (960, 540) if draft else (timeline["width"], timeline["height"])
    words = output_words(project, timeline)
    cap_spec = edl.get("captions", True)
    translation = None
    if cap_spec and lang and lang != "en":
        path = project.cut_dir(version) / f"captions.{lang}.json"
        if not path.exists():
            raise YapError(f"No translated captions at {path}")
        translation = [{**c, "start": c["start"] - offset, "end": c["end"] - offset}
                       for c in split_translation(read_json(path), 3, 22) if c["end"] > offset and c["start"] < offset + timeline["duration"]]
    effects = []
    matte_types = {e["id"] for e in catalog()["effects"] if e["matte"]}
    for effect in config["effects"]:
        if not effect.get("enabled", True) or effect["at"] >= offset + timeline["duration"] or effect["at"] + effect["duration"] <= offset:
            continue
        e = {**effect, "at": effect["at"] - offset}
        if "joinAt" in e:
            e["joinAt"] -= offset
        if e.get("asset"):
            e["asset"] = str(asset_path(project, e["asset"]))
            if Path(e["asset"]).suffix.lower() in {".mp4", ".mov", ".webm", ".m4v"}:
                from .media import probe
                e["assetDuration"] = probe(Path(e["asset"]))["duration"]
        effects.append(e)
    mask = prepare_matte(plate, work, timeline["fps"]) if any(e["type"] in matte_types for e in effects) else None
    people = read_json(project.root / "people.json") if (project.root / "people.json").exists() else []
    from .overlays import _phrase_time
    names = {p["id"]: p for p in people}
    thirds = []
    full_timeline = read_json(project.cut_dir(version) / "timeline.json") if offset else timeline
    for lt in edl.get("lower_thirds", []):
        if lt.get("person") not in names:
            raise YapError(f"Unknown name card person: {lt.get('person')}")
        at = (_phrase_time(project, full_timeline, lt["at"]) if isinstance(lt.get("at"), str) else float(lt.get("at", .8))) - offset
        if at < timeline["duration"] and at + lt.get("duration", 4.5) > 0:
            thirds.append({**lt, **names[lt["person"]], "at": at})
    original = config['preset'] == 'original'
    manifest = {"schema": 1, "pack": config["preset"] if not original else "volt",
                "original": original, "accent": config.get("accent") or (load_style(project)['accent'] if original else None), "motion": config["motion"],
                "width": w, "height": h, "fps": timeline["fps"], "duration": timeline["duration"], "plate": str(plate),
                "words": words if cap_spec else [], "translation": translation if cap_spec else None, "effects": effects, "mask": mask,
                "captionStyle": resolve_caption_style(project, timeline, cap_spec) if original and cap_spec else None,
                "thirds": thirds, "scenes": config.get("scenes", []), "shoot": {"width": w, "height": h, **face_measurements(plate, w, h)}}
    return manifest


def render_styled(project: Project, version: str, plate: Path, work: Path, timeline: dict, config: dict,
                  edl: dict, draft: bool, offset: float = 0, lang: str | None = None) -> Path:
    renderer = studio_dir()
    if not (renderer / "node_modules/@remotion/renderer").exists():
        raise YapError(f'Set up styles once with: npm ci --prefix "{renderer}"')
    manifest = visual_plan(project, version, plate, work, timeline, config, edl, draft, offset, lang)
    spec = work / "visuals-render.json"
    write_json(spec, manifest)
    out = work / "styled.mp4"
    cmd = ["node", str(renderer / "render.mjs"), str(spec), str(out)]
    proc = subprocess.run(cmd, cwd=renderer)
    if proc.returncode or not out.exists():
        raise YapError("The style/effects render failed. See the renderer's message above; the original cut is unchanged.")
    return out


def preview_source(project: Project, version: str, matte: bool = False) -> dict:
    """Cache the undecorated cut once; style changes then play in the browser."""
    import tempfile
    from .render import cut_plate
    timeline = read_json(project.cut_dir(version) / 'timeline.json')
    digest = hashlib.sha256(json.dumps(timeline, sort_keys=True).encode())
    for src in project.sources():
        path = Path(src['path'])
        stat = path.stat()
        digest.update(f'{path}:{stat.st_size}:{stat.st_mtime_ns}'.encode())
    digest.update(json.dumps(read_json(project.root / 'style.json') if (project.root / 'style.json').exists() else {}, sort_keys=True).encode())
    # Increment this tag when the cut-only encoding changes.
    digest.update(b'live-preview-v1')
    plate = project.root / 'renders' / f'__live-{version}-{digest.hexdigest()[:20]}.mp4'
    (project.root / 'cache').mkdir(exist_ok=True)
    plate.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='live-preview-', dir=project.root / 'cache') as temp:
        work = Path(temp)
        if not plate.exists():
            joined = cut_plate(project, timeline, work, True)
            pending = work / 'plate.mp4'
            run(['ffmpeg', '-v', 'error', '-y', '-i', str(joined), '-map', '0:v:0', '-map', '0:a:0',
                 '-t', str(timeline['duration']), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
                 '-movflags', '+faststart', str(pending)])
            pending.replace(plate)
        edl_path = project.cut_dir(version) / 'edl.json'
        edl = read_json(edl_path) if edl_path.exists() else {}
        plan = visual_plan(project, version, plate, work, timeline,
                           {'preset':'original','motion':'balanced','effects':[]}, edl, True)
        plan['cutBoundaries'] = [s['out_start'] for s in timeline['segments'][1:]]
        from .media import probe
        plan['assetDurations'] = {}
        for asset in (project.root / 'uploads').glob('*'):
            if asset.is_file() and asset.resolve().is_relative_to(project.root / 'uploads') and asset.suffix.lower() in {'.mp4', '.mov', '.webm', '.m4v'}:
                try:
                    plan['assetDurations'][str(asset.relative_to(project.root))] = probe(asset)['duration']
                except YapError:
                    pass  # An unused or unfinished upload must not block style comparison.
        if matte:
            plan['mask'] = prepare_matte(plate, work, timeline['fps'])
    return plan
