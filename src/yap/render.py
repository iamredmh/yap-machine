"""Render a resolved timeline to MP4.

1. Each segment is cut from the source (frame-aligned, picture from the
   camera, sound from the synced mic when there is one) with 15 ms fades at
   both edges so joins never click. Intermediates are H.264 + PCM in MKV, so
   joining them adds no AAC priming gaps.
2. Segments are joined without re-encoding.
3. Two-pass loudness normalisation to -14 LUFS / -1 dBTP (YouTube, socials),
   AAC 192k, faststart MP4.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .project import Project, YapError, read_json, run

LOUD_I, LOUD_TP, LOUD_LRA = -14.0, -1.0, 11.0
FADE = 0.015


def _segment_cmd(project: Project, seg: dict, tl: dict, out: Path, draft: bool) -> list[str]:
    src = project.source(seg["source"])
    start, dur = seg["start"], seg["end"] - seg["start"]
    w, h = (960, 540) if draft else (tl["width"], tl["height"])
    if draft and tl["height"] > tl["width"]:
        w, h = 540, 960
    z = float(seg.get("zoom", 1.0))
    if seg.get("crop"):
        # reframed (e.g. 9:16 around the face); the crop already includes any punch-in
        x, y, cw, ch = seg["crop"]
        crop = (f"crop=trunc(iw*{cw:.5f}/2)*2:trunc(ih*{ch:.5f}/2)*2:"
                f"trunc(iw*{x:.5f}):trunc(ih*{y:.5f}),")
    else:
        # punch in around the upper-middle of frame, where a talking head's face sits
        crop = (f"crop=iw/{z:.4f}:ih/{z:.4f}:(iw-iw/{z:.4f})/2:(ih-ih/{z:.4f})*0.4," if z > 1.001 else "")
    # setpts first: the seek below lands half a frame early, so frame 0 is the
    # source frame nearest `start` even when timestamps jitter (OBS, phones)
    vf = (f"setpts=PTS-STARTPTS,{crop}scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,"
          f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={tl['fps']},format=yuv420p")
    af = (f"afade=t=in:st=0:d={FADE},afade=t=out:st={max(0.0, dur - FADE):.4f}:d={FADE},"
          f"aresample=48000,apad")
    seek = max(0.0, start - 0.5 / (src.get("fps") or tl["fps"]))
    cmd = ["ffmpeg", "-v", "error", "-y", "-nostdin", "-ss", f"{seek:.4f}", "-i", src["path"]]
    audio_map = "0:a:0"
    video = ["-vf", vf]
    video_map = "0:v:0"
    n_inputs = 1
    if seg.get("screen"):
        # the screen fills the frame; the camera becomes a picture-in-picture
        from .layout import screen_filter
        from .overlays import load_style
        scr = project.source(seg["screen"]["source"])
        s_seek = max(0.0, seg["screen"]["start"] - 0.5 / (scr.get("fps") or 60))
        cmd += ["-ss", f"{s_seek:.4f}", "-i", scr["path"]]
        n_inputs = 2
        canvas = load_style(project).get("canvas", "#FAFAF9")
        video = ["-filter_complex", screen_filter(seg, w, h, tl["fps"], canvas)]
        video_map = "[v]"
    # the camera's own audio shares that early seek: trim it back to `start`
    lead = f"atrim=start={start - seek:.5f},asetpts=PTS-STARTPTS," if start - seek > 1e-6 else ""
    audio = src.get("audio")
    c0, c1 = (audio or {}).get("range", [0.0, src["duration"]])
    if audio and c0 <= start and seg["end"] <= c1:
        mic = project.source(audio["source"])
        from .sync import mic_time
        cmd += ["-ss", f"{mic_time(audio, start):.4f}", "-i", mic["path"]]
        audio_map = f"{n_inputs}:a:0"
        lead = ""
    af = lead + af
    preset, crf = ("ultrafast", "30") if draft else ("medium", "17")
    cmd += [
        "-t", f"{dur:.4f}",
        "-map", video_map, "-map", audio_map,
        *video, "-af", af, "-ac", "2",
        "-c:v", "libx264", "-preset", preset, "-crf", crf,
        "-g", str(int(round(tl["fps"] * 2))),
        "-c:a", "pcm_s16le",
        str(out),
    ]
    return cmd


def _measure_loudness(path: Path) -> dict | None:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn",
         "-af", f"loudnorm=I={LOUD_I}:TP={LOUD_TP}:LRA={LOUD_LRA}:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True)
    if proc.returncode:
        return None
    s = proc.stderr
    a, b = s.rfind("{"), s.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        measured = json.loads(s[a:b + 1])
        # Silence reports -inf loudness/peak and inf offset. These are valid
        # measurement results, but invalid second-pass filter arguments.
        # Unmeasurable audio keeps its original level in the final pass.
        bounds = {"input_i": (-99, 0), "input_tp": (-99, 99), "input_lra": (0, 99),
                  "input_thresh": (-99, 0), "target_offset": (-99, 99)}
        for key, (lo, hi) in bounds.items():
            value = float(measured[key])
            if not math.isfinite(value) or not lo <= value <= hi:
                return None
        return measured
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


def cut_plate(project: Project, tl: dict, work: Path, draft: bool, jobs: int = 4) -> Path:
    """Create the uncaptioned cut for both live preview and final rendering."""
    segs = tl["segments"]
    parts = [work / f"seg{i:04d}.mkv" for i in range(len(segs))]

    def do(i: int) -> None:
        r = subprocess.run(_segment_cmd(project, segs[i], tl, parts[i], draft), capture_output=True, text=True)
        if r.returncode != 0:
            raise YapError(f"segment {i} failed: {r.stderr[-600:]}")

    print(f"cutting {len(segs)} segments ({'draft' if draft else 'full quality'}) …")
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        list(ex.map(do, range(len(segs))))

    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in parts))
    joined = work / "joined.mkv"
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)])

    return joined


def render(project: Project, version: str, draft: bool = False, jobs: int = 4, lang: str | None = None,
           visual_export: bool = False, preview_at: float | None = None, visual_settings: dict | None = None) -> Path:
    """lang: burn the captions.<lang>.json translation instead (renders/<version>.<lang>.mp4)."""
    cut = project.cut_dir(version)
    tl_path = cut / "timeline.json"
    if not tl_path.exists():
        raise YapError(f"no timeline for {version}; run `yap-machine resolve {version}` first")
    tl = read_json(tl_path)
    full_timeline = tl
    import hashlib
    timeline_rev = hashlib.sha256(tl_path.read_bytes()).hexdigest()
    from .visuals import active, load_config, render_styled, trim_timeline
    from .visuals import validate
    config = validate(project, tl, visual_settings) if visual_settings is not None else load_config(project, version, tl)
    styled = active(config)
    if preview_at is not None:
        if not 0 <= preview_at < tl["duration"]:
            raise YapError("Preview start must be inside the cut")
        tl = trim_timeline(tl, preview_at)
        draft = True
    segs = tl["segments"]
    if not segs:
        raise YapError("timeline has no segments")

    import tempfile
    (project.root / "cache").mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=f"render-{tl['version']}-", dir=project.root / "cache"))
    joined = cut_plate(project, tl, work, draft, jobs)

    out = project.render_path(version, draft, lang)
    if visual_export:
        suffix = "styled-preview" if preview_at is not None else "styled"
        out = out.with_name(f"{version}-{suffix}.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    # captions / lower thirds: burned in during the final pass
    from .overlays import build as build_overlays
    edl_path = cut / "edl.json"
    edl = read_json(edl_path) if edl_path.exists() else {}
    if lang:
        spec = edl.get("captions")
        edl["captions"] = {**(spec if isinstance(spec, dict) else {}), "language": lang}
    if not styled and (edl.get('captions') or edl.get('lower_thirds')):
        # Some FFmpeg distributions omit libass. The local compositor can also
        # draw the original caption settings, so captions still work there.
        styled = ' ass ' not in run(['ffmpeg', '-hide_banner', '-filters']).stdout
    ass = build_overlays(project, version, full_timeline, edl, lang) if edl and (preview_at is None or not styled) else None
    picture = render_styled(project, version, joined, work, tl, config, edl, draft, preview_at or 0, lang) if styled else joined
    vcodec = ["-c:v", "copy"]
    if ass and not styled:
        esc = str(ass).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        preset, crf = ("ultrafast", "30") if draft else ("medium", "17")
        vf = f"ass='{esc}'"
        if preview_at:
            vf = f"setpts=PTS+{preview_at:.6f}/TB,{vf},setpts=PTS-STARTPTS"
        vcodec = ["-vf", vf, "-c:v", "libx264", "-preset", preset, "-crf", crf,
                  "-pix_fmt", "yuv420p", "-g", str(int(round(tl["fps"] * 2)))]

    m = _measure_loudness(joined)
    if m:
        af = (f"loudnorm=I={LOUD_I}:TP={LOUD_TP}:LRA={LOUD_LRA}:measured_I={m['input_i']}:"
              f"measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
              f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000")
    else:
        # One-pass loudnorm can also produce NaN samples on short silence.
        # Preserve silent/ungated audio instead of trying to amplify it.
        af = "aresample=48000"
    # Publish atomically: a failed export never replaces a playable version.
    temp_out = work / "finished.mp4"
    # Keep the joined PCM audio through the final pass. Chromium's intermediate
    # AAC adds encoder padding; the edit's audio and duration are authoritative.
    audio_input = ["-i", str(joined)] if styled else []
    audio_index = 1 if styled else 0
    run(["ffmpeg", "-v", "error", "-y", "-i", str(picture), *audio_input,
         "-map", "0:v:0", "-map", f"{audio_index}:a:0", "-t", f"{tl['duration']:.6f}", *vcodec, "-af", af,
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(temp_out)])
    temp_out.replace(out)
    if visual_export:
        from .project import write_json
        write_json(cut / ("visual-preview.json" if preview_at is not None else "visual-export.json"), {
            "file": str(out.relative_to(project.root)), "revision": config.get("rev", 0),
            "preview": preview_at is not None, "at": preview_at or 0, "timelineRev": timeline_rev,
        })
    shutil.rmtree(work, ignore_errors=True)
    return out
