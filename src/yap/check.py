"""Automated checks on a cut, before anyone watches it.

Reads the timeline (and the render, if there is one) and writes cuts/vN/qc.md.
Errors block a version from going to review; warnings are for the agent to judge.
"""

from __future__ import annotations

import json
import re
import subprocess

import numpy as np

from .levels import ENV_HOP, SPEECH_RUN_COVERED, SPEECH_RUN_MIN, envelope, levels, silences, speech_past_cut  # noqa: F401
from .pack import is_cutoff, is_filler
from pathlib import Path

from .project import Project, fmt_tc, read_json

THUMB_W, THUMB_H = 64, 36


def _thumb(path: str, t: float) -> np.ndarray | None:
    pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1",
                         "-vf", f"scale={THUMB_W}:{THUMB_H},format=gray", "-f", "rawvideo", "-"],
                        capture_output=True)
    if pr.returncode != 0 or len(pr.stdout) != THUMB_W * THUMB_H:
        return None
    return np.frombuffer(pr.stdout, np.uint8).astype(np.float32)


def shot_reference(project: Project, src: dict) -> np.ndarray | None:
    """Median of ~24 frames across a locked-off source: what the shot normally looks like."""
    cache = project.root / "cache" / f"{src['id']}.shot.npy"
    if cache.exists():
        return np.load(cache)
    frames = [f for f in (_thumb(src["path"], t) for t in np.linspace(1, src["duration"] - 1, 24)) if f is not None]
    if len(frames) < 6:
        return None
    ref = np.median(np.stack(frames), axis=0)
    np.save(cache, ref)
    return ref

INSIDE_WORD_MARGIN = 0.04
def _render_stats(path) -> dict:
    out = {}
    pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
                         "-of", "json", str(path)], capture_output=True, text=True)
    for st in json.loads(pr.stdout or "{}").get("streams", []):
        out[f"{st['codec_type']}_duration"] = float(st.get("duration", 0) or 0)
    lo = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn",
                         "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", lo.stderr)
    p = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", lo.stderr)
    if m:
        out["lufs"] = float(m[-1])
    if p:
        out["true_peak"] = float(p[-1])
    return out


def placement(project: Project, render, timeline: dict) -> list[str]:
    """For every segment, confirm the render shows the right source frame and
    plays the right moment of the program audio. Exact, so any sync or join
    error shows up here (mouth-motion measures get confused by punch-ins)."""
    from .media import load_audio
    from .sync import mic_time
    problems = []
    sr = 8000
    ra = load_audio(render, sr)
    for k, s in enumerate(timeline["segments"]):
        src = project.source(s["source"])
        dur = s["end"] - s["start"]
        fps = timeline["fps"]
        probe = round(min(0.6, dur / 2) * fps) / fps
        # Seek just before the selected frame, as the renderer does. A fixed
        # 200 ms search window only has five preceding frames at 25 fps.
        render_frame = round((s["out_start"] + probe) * fps)
        rf = _frames(str(render), max(0, render_frame - .5) / fps, 1)
        if s.get("screen"):
            scr = project.source(s["screen"]["source"])
            target_frame = round((s["screen"]["start"] + probe) * fps)
            first_frame = max(0, target_frame - 5)
            expected = target_frame - first_frame
            sf = _screen_frames(scr["path"], max(0, first_frame - .5) / fps, 11, s["screen"].get("crop"),
                                timeline["width"], timeline["height"], timeline["fps"])
            what = "screen"
        else:
            source_fps = src.get("fps") or fps
            target_frame = round((s["start"] + probe) * source_fps)
            first_frame = max(0, target_frame - 5)
            expected = target_frame - first_frame
            sf = _frames(src["path"], max(0, first_frame - .5) / source_fps, 11,
                         s.get("zoom", 1.0), s.get("crop"), (timeline["width"], timeline["height"]))
            what = "picture"
        if len(rf) and len(sf) > expected:
            top = int(THUMB_H * 0.5)    # burned-in captions, name cards and the PiP sit below this
            d = [float(np.abs(rf[0][:top] - f[:top]).mean()) for f in sf]
            best = int(np.argmin(d))
            # static shots (a still screen, a still speaker) match several frames equally well:
            # only call it misplaced when the intended frame is clearly worse
            if best != expected and d[expected] - d[best] > 0.25:
                problems.append(f"{fmt_tc(s['out_start'])} {what} is {best - expected:+d} frames from where it should be")
        audio = src.get("audio")
        c0, c1 = (audio or {}).get("range", [0, src["duration"]])
        if dur < 0.8:
            continue
        a = ra[int((s["out_start"] + 0.2) * sr):int((s["out_start"] + min(1.2, dur - 0.1)) * sr)]
        if audio and c0 <= s["start"] and s["end"] <= c1:
            source_at = mic_time(audio, s["start"] + 0.2)
            reference_start = max(0.0, source_at - 0.25)
            ref = load_audio(Path(project.source(audio["source"])["path"]), sr,
                             start=reference_start, duration=len(a) / sr + 0.5)
        else:
            source_at = s["start"] + 0.2
            reference_start = max(0.0, source_at - 0.25)
            ref = load_audio(Path(src["path"]), sr, start=reference_start, duration=len(a) / sr + 0.5)
        if len(a) < sr // 4 or len(ref) <= len(a) or np.abs(a).max() < 1e-3:
            continue
        win = np.lib.stride_tricks.sliding_window_view(ref, len(a))
        score = win @ a / (np.linalg.norm(win, axis=1) + 1e-9)
        lag_ms = (int(np.argmax(score)) / sr - (source_at - reference_start)) * 1000
        if abs(lag_ms) > 20:
            problems.append(f"{fmt_tc(s['out_start'])} sound is {lag_ms:+.0f} ms from where it should be")
    return problems


def overlay_checks(project: Project, version: str, timeline: dict, lang: str | None = None) -> dict:
    """Captions fit, and don't collide with the lower third."""
    from .overlays import caption_lines
    lay_path = project.cut_dir(version) / (f"layout.{lang}.json" if lang else "layout.json")
    errors, warnings = [], []
    if not lay_path.exists():
        return {"errors": errors, "warnings": warnings, "layout": None}
    lay = read_json(lay_path)
    H = timeline["height"]
    box = lay.get("caption_box")
    if box:
        for c in lay["captions"]:
            n = caption_lines(c["text"], box["font"], box["size"], box["max_width"])
            if n > box["lines"]:
                errors.append(f"{fmt_tc(c['t0'])} caption needs {n} lines: \"{c['text'][:40]}\"")
            c["top"] = box["y"] * H - n * box["size"] * 1.2
        for lt in lay["lower_thirds"]:
            for c in lay["captions"]:
                if c["t0"] < lt["t1"] and lt["t0"] < c["t1"] and lt["y"] + lt["h"] > c["top"] - 0.01 * H:
                    errors.append(f"{fmt_tc(c['t0'])} caption overlaps the lower third")
                    break
    for lt in lay["lower_thirds"]:
        if lt["x"] + lt["w"] > 0.95 * timeline["width"] or lt["y"] + lt["h"] > 0.95 * H:
            errors.append(f"{fmt_tc(lt['t0'])} lower third runs off the safe area")
    return {"errors": errors, "warnings": warnings, "layout": lay}


def face_in_frame(render, timeline: dict, layout: dict | None = None) -> dict:
    """For reframed cuts: the speaker's face must be in shot, roughly centred,
    and not cut off at the top, in every segment."""
    import cv2
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    errors, warnings = [], []
    W = 360
    H = int(round(W * timeline["height"] / timeline["width"]))
    for s in timeline["segments"]:
        t = (s["out_start"] + s["out_end"]) / 2
        pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{t:.3f}", "-i", str(render),
                             "-frames:v", "1", "-vf", f"scale={W}:{H},format=gray", "-fps_mode", "passthrough",
                             "-f", "rawvideo", "-"], capture_output=True)
        if len(pr.stdout) != W * H:
            continue
        g = np.frombuffer(pr.stdout, np.uint8).reshape(H, W)
        f = casc.detectMultiScale(g, 1.1, 5, minSize=(W // 8, W // 8))
        if len(f) == 0:
            warnings.append(f"{fmt_tc(s['out_start'])} couldn't find the speaker's face in the reframed shot")
            continue
        x, y, fw, fh = max(f, key=lambda r: r[2] * r[3])
        cx = (x + fw / 2) / W
        if not 0.25 <= cx <= 0.75:
            errors.append(f"{fmt_tc(s['out_start'])} face is off to the side of the vertical frame ({cx:.0%} across)")
        if y < 0.02 * H:
            errors.append(f"{fmt_tc(s['out_start'])} top of the head is cut off")
        if layout:
            fx0, fy0 = x / W * timeline["width"], y / H * timeline["height"]
            fx1, fy1 = (x + fw) / W * timeline["width"], (y + fh) / H * timeline["height"]
            for lt in layout.get("lower_thirds", []):
                if lt["t0"] <= t <= lt["t1"] and lt["x"] < fx1 and fx0 < lt["x"] + lt["w"] \
                        and lt["y"] < fy1 and fy0 < lt["y"] + lt["h"]:
                    errors.append(f"{fmt_tc(t)} the name card covers the speaker's face")
        if layout and layout.get("caption_box"):
            face_bottom = (y + fh) / H * timeline["height"]
            for c in layout["captions"]:
                if c["t0"] <= t <= c["t1"] and c.get("top", 1e9) < face_bottom:
                    errors.append(f"{fmt_tc(t)} captions cover the speaker's face")
                    break
    return {"errors": errors, "warnings": warnings}


def _screen_frames(path: str, t: float, n: int, crop: list | None, W: int, H: int, fps: float) -> np.ndarray:
    """Screen recording frames laid out as the screen layout lays them out."""
    sc = ""
    if crop:
        cx, cy, cw, ch = crop
        sc = f"crop=trunc(iw*{cw}/2)*2:trunc(ih*{ch}/2)*2:trunc(iw*{cx}):trunc(ih*{cy}),"
    pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{max(0.0, t):.6f}", "-i", path,
                         "-vf", f"setpts=PTS-STARTPTS,{sc}scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
                                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0xFAFAF9,setsar=1,fps={fps},scale={THUMB_W}:{THUMB_H},format=gray",
                         "-frames:v", str(n), "-f", "rawvideo", "-"], capture_output=True)
    k = len(pr.stdout) // (THUMB_W * THUMB_H)
    return np.frombuffer(pr.stdout[:k * THUMB_W * THUMB_H], np.uint8).reshape(k, THUMB_H, THUMB_W).astype(np.float32)


def _frames(path: str, t: float, n: int, zoom: float = 1.0, rect: list | None = None,
            canvas: tuple[int, int] | None = None) -> np.ndarray:
    if rect:
        x, y, cw, ch = rect
        crop = (f"crop=trunc(iw*{cw:.5f}/2)*2:trunc(ih*{ch:.5f}/2)*2:"
                f"trunc(iw*{x:.5f}):trunc(ih*{y:.5f}),")
    else:
        crop = (f"crop=iw/{zoom:.4f}:ih/{zoom:.4f}:(iw-iw/{zoom:.4f})/2:(ih-ih/{zoom:.4f})*0.4,"
                if zoom > 1.001 else "")
    fit = ""
    if canvas:
        w, h = canvas
        fit = (f"scale={w}:{h}:force_original_aspect_ratio=decrease:flags=lanczos,"
               f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,")
    pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{max(0.0, t):.6f}", "-i", path,
                         "-frames:v", str(n), "-vf", f"{crop}{fit}scale={THUMB_W}:{THUMB_H},format=gray",
                         # passthrough: never pad the start with a duplicated frame after a seek
                         "-fps_mode", "passthrough", "-f", "rawvideo", "-"], capture_output=True)
    k = len(pr.stdout) // (THUMB_W * THUMB_H)
    return np.frombuffer(pr.stdout[:k * THUMB_W * THUMB_H], np.uint8).reshape(k, THUMB_H, THUMB_W).astype(np.float32)


def check(project: Project, version: str, lang: str | None = None, deep: bool = True) -> dict:
    cut = project.cut_dir(version)
    tl = read_json(cut / "timeline.json")
    phrases = {p["id"]: p for p in read_json(project.root / "phrases.json")}
    by_word = {}
    for p in phrases.values():
        for i in range(p["w0"], p["w1"] + 1):
            by_word[(p["source"], i)] = p
    words = {s: read_json(project.transcript_path(s))["words"] for s in {x["source"] for x in tl["segments"]}}

    errors: list[str] = []
    warns: list[str] = []
    envs = {}
    for sid in words:
        src = project.source(sid)
        env = envelope(project, src)
        envs[sid] = (env, levels(env)[2], shot_reference(project, src) if src["kind"] == "camera" else None, src)
    kept_phrases: set[str] = set()
    fillers = cutoffs = 0
    joins: list[str] = []

    for k, s in enumerate(tl["segments"]):
        ws = words[s["source"]]
        dur = s["end"] - s["start"]
        at = fmt_tc(s["out_start"])
        if dur < 0.4:
            warns.append(f"{at} very short segment ({dur:.2f}s) — likely a stray word")
        inside = [i for i, w in enumerate(ws) if w["end"] > s["start"] and w["start"] < s["end"]]
        for i in inside:
            w = ws[i]
            if s["w"] and not (s["w"][0] <= i <= s["w"][1]):
                # word not meant to be in this segment but overlapping its padding
                if w["start"] < s["end"] - INSIDE_WORD_MARGIN and w["end"] > s["start"] + INSIDE_WORD_MARGIN:
                    warns.append(f"{at} edge clips a neighbouring word \"{w['text']}\"")
                continue
            if (s["source"], i) in by_word:
                kept_phrases.add(by_word[(s["source"], i)]["id"])
            if is_filler(w["text"]):
                fillers += 1
            if is_cutoff(w["text"]):
                cutoffs += 1
                warns.append(f"{at} keeps a broken-off word \"{w['text']}\"")
        env, thresh, ref, src = envs[s["source"]]
        loud = levels(env)[1] - 15
        for edge in ("start", "end"):
            run, stops, covered = speech_past_cut(env, ws, s[edge], edge, loud)
            if run >= SPEECH_RUN_MIN and covered < SPEECH_RUN_COVERED:
                where = fmt_tc(s["out_start"] if edge == "start" else s["out_end"])
                span = f"{fmt_tc(min(s[edge], stops))}–{fmt_tc(max(s[edge], stops))}"
                warns.append(f"{where} the cut {'starts' if edge == 'start' else 'ends'} inside speech: sound runs "
                             f"{run:.2f}s {'back from the start' if edge == 'start' else 'on past the end'} (source {span}) with no "
                             f"transcript words for it, so word timings are probably off here or words were dropped; "
                             f"{'the first word may be clipped or a stray word left in' if edge == 'start' else 'the last word may be clipped'}. "
                             f"Listen to the source there")
        for s0, s1 in silences(env, s["start"], s["end"], 1.0, thresh):
            warns.append(f"{fmt_tc(s['out_start'] + s0 - s['start'])} {s1 - s0:.1f}s of dead air inside a segment")
        if ref is not None:
            for t in (s["start"] + 0.05, (s["start"] + s["end"]) / 2, s["end"] - 0.05):
                f = _thumb(src["path"], t)
                if f is not None and float(np.mean(np.abs(f - ref))) > 18:
                    # An appearance change can be an intentional graphic or
                    # camera movement. Keep it visible for review, without
                    # declaring an otherwise correctly rendered cut invalid.
                    warns.append(f"{fmt_tc(s['out_start'] + t - s['start'])} the shot looks different from the rest "
                                  f"(something in front of the lens, or framing moved) — look at source {fmt_tc(t)}")
                    break
        if k > 0:
            prev = tl["segments"][k - 1]
            tail = " ".join(prev["text"].split()[-4:])
            head = " ".join(s["text"].split()[:4])
            joins.append(f"| {at} | …{tail} | {head}… |")

    edge_moves = [n for n in tl.get("notes", []) if n.startswith("moved the ")]
    for n in tl.get("notes", []):
        if n not in edge_moves:
            warns.append(n)
    for pid in sorted(kept_phrases):
        p = phrases[pid]
        if "retake" in p["flags"] and p.get("retake_of") in kept_phrases:
            warns.append(f"keeps {pid} and its retake {p['retake_of']} — the line may be said twice")
        elif "retake" in p["flags"]:
            warns.append(f"keeps {pid}, which has a later retake ({p['retake_of']}) — check it's the better take")
    if fillers:
        warns.append(f"{fillers} filler word(s) kept")

    stats = {}
    render = project.render_path(version, lang=lang)
    if not render.exists():
        render = project.render_path(version, draft=True, lang=lang)
    if render.exists():
        stats = _render_stats(render)
        vd, ad = stats.get("video_duration", 0), stats.get("audio_duration", 0)
        if abs(vd - tl["duration"]) > 0.25:
            errors.append(f"render is {vd:.2f}s but the timeline is {tl['duration']:.2f}s")
        if abs(vd - ad) > 0.1:
            errors.append(f"audio ({ad:.2f}s) and video ({vd:.2f}s) lengths differ — sync drift")
        placed = placement(project, render, tl)
        errors.extend(placed)
        stats["placement_ok"] = not placed
        ov = overlay_checks(project, version, tl, lang)
        errors.extend(ov["errors"])
        warns.extend(ov["warnings"])
        if any(x.get("crop") for x in tl["segments"]):
            framed = face_in_frame(render, tl, ov["layout"])
            errors.extend(framed["errors"])
            warns.extend(framed["warnings"])
        if deep:
            # re-listen to the render itself: words either side of every cut, room sound, a sheet per join
            from .joins import review
            jr = review(project, version, lang)
            warns.extend(jr["warnings"])
            stats["joins_flagged"] = jr["flagged"]
    # Is the sync itself right? Mouth vs mic on source stretches this cut uses.
    from .sync import verify
    stats["sync_checks"] = []
    for sid in words:
        src = project.source(sid)
        if not src.get("audio"):
            continue
        starts = sorted({x["start"] for x in tl["segments"] if x["source"] == sid})
        picks = [starts[0], starts[len(starts) // 2], starts[-1]] if len(starts) >= 3 else starts
        for v in verify(project, src, picks):
            stats["sync_checks"].append({"source": sid, **v})
            if v.get("inconclusive"):
                warns.append(f"mouth/mic check near source {fmt_tc(v['at'])}: {v['reason']}")
                continue
            if 3 <= v["z"] < 4:
                warns.append(f"mouth/mic match near source {fmt_tc(v['at'])} is weak ({v['z']}σ) — worth a look")
            if v["z"] < 3:
                errors.append(f"sound for {sid} doesn't follow the mouth near source {fmt_tc(v['at'])} "
                              f"(match {v['r']}, {v['z']}σ above chance) — the mic sync is probably wrong")
            elif abs(v["frames"]) > 3:
                warns.append(f"mouth and mic differ by {v['frames']:+d} frames near source {fmt_tc(v['at'])}")
        if "lufs" in stats and abs(stats["lufs"] + 14) > 1.5:
            warns.append(f"loudness {stats['lufs']} LUFS (target -14)")

    lines = [f"# QC — {tl['version']}", "",
             f"- Length: **{fmt_tc(tl['duration'])}** in {len(tl['segments'])} segments, {len(joins)} joins",
             f"- Phrases kept: {len(kept_phrases)} of {len(phrases)}"]
    if stats:
        lines.append(f"- Render: {render.name}, loudness {stats.get('lufs', '?')} LUFS, "
                     f"peak {stats.get('true_peak', '?')} dBFS")
        if "placement_ok" in stats:
            lines.append(f"- Placement: every segment's picture and sound checked against the source — "
                         f"{'all exact' if stats['placement_ok'] else 'PROBLEMS (see errors)'}")
    sync_lines = []
    for sid in words:
        a = project.source(sid).get("audio")
        if a:
            sync_lines.append(f"- Sound for {sid}: {a['source']}, synced by {a.get('method', 'audio')}, "
                              f"offset {a['offset']:+.3f}s, drift {a.get('drift_ppm', 0):+.0f} ppm")
    for v in stats.get("sync_checks", []):
        sync_lines.append(f"  - mouth vs mic near {fmt_tc(v['at'])}: match {v['r']} ({v['z']}σ above chance), {v['frames']:+d} frames")
    lines += sync_lines
    lines += [f"- Edge settled: {m[len('moved the '):]}" for m in edge_moves]
    if "joins_flagged" in stats:
        lines.append(f"- Joins: the render was re-listened to at all {len(joins)}; {stats['joins_flagged']} flagged "
                     f"(see joins.md, with a picture per join in joins/)")
    lines += ["", f"## Errors ({len(errors)})", *([f"- {e}" for e in errors] or ["- none"]),
              "", f"## Warnings ({len(warns)})", *([f"- {w}" for w in warns] or ["- none"]),
              "", "## Joins", "", "| at | out of | into |", "|---|---|---|", *joins, ""]
    (cut / (f"qc.{lang}.md" if lang else "qc.md")).write_text("\n".join(lines))
    return {"errors": errors, "warnings": warns, "duration": tl["duration"], "joins": len(joins), **stats}
