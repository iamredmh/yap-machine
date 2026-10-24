"""Resolve the agent's edl.json into exact cut points (timeline.json).

EDL (written by the agent, cuts/vN/edl.json):

{
  "brief": "6-minute YouTube piece on the v3 rollout",
  "format": {"width": 1920, "height": 1080},
  "max_pause": 0.6,          # shorten pauses longer than this inside kept ranges (jump cut); null keeps them
  "drop_fillers": true,      # cut um/uh out of kept ranges
  "punch_in": 1.12,          # alternate this zoom on jump cuts within a camera; 0 turns it off
  "ranges": [
    {"from": "P003", "to": "P007", "beat": "hook", "why": "cleanest opening"},
    {"from": "P012", "start_at": "Second, we've", "end_after": "in one place.", "skip": ["P014"]},
    {"source": "C0017", "start": 312.4, "end": 318.0}
  ]
}

`from`/`to` are phrase ids from takes.md (same source, `to` defaults to `from`).
`start_at` / `end_after` trim inside the first / last phrase by quoting words.
`skip` drops phrases inside a range.
`quote` (optional, recommended) a few words from the `from` phrase; resolve
refuses to cut if the phrase no longer says them (ids shift after re-transcribing).
"""

from __future__ import annotations

import re

import numpy as np

from .edges import describe, sample_reader, settle_edge, slice_transcriber
from .levels import ENV_HOP, envelope, levels, silences
from .pack import is_filler, norm
from .project import Project, YapError, fmt_tc, normalise_version, read_json, write_json

CLAUSE_PAUSE = 0.8
MID_CLAUSE_PAUSE = 1.0
PUNCH_IN = 1.12
HEAD_PAD = 0.08
TAIL_PAD = 0.14
SNAP_WINDOW = 0.07


# -------- snapping cuts into the quietest spot --------------------------------

def snap(env: np.ndarray, t: float, lo: float, hi: float) -> float:
    """Move t to the quietest 10ms frame within ±SNAP_WINDOW, staying in [lo, hi]."""
    a = max(lo, t - SNAP_WINDOW)
    b = min(hi, t + SNAP_WINDOW)
    if b <= a:
        return min(max(t, lo), hi)
    i0, i1 = int(a / ENV_HOP), int(b / ENV_HOP) + 1
    seg = env[i0:i1]
    if len(seg) == 0:
        return t
    # prefer the spot nearest t among those within 2 dB of the minimum
    floor = seg.min() + 2.0
    cands = np.where(seg <= floor)[0]
    best = cands[np.argmin(np.abs((i0 + cands) * ENV_HOP - t))]
    return float(min(max((i0 + best) * ENV_HOP, lo), hi))


# -------- EDL → word runs ---------------------------------------------------

def _find_snippet(words: list[dict], lo: int, hi: int, snippet: str, last: bool) -> tuple[int, int]:
    target = [n for n in (norm(w) for w in snippet.split()) if n]
    if not target:
        raise YapError(f"empty snippet '{snippet}'")
    seq = [norm(words[i]["text"]) for i in range(lo, hi + 1)]
    hits = [k for k in range(len(seq) - len(target) + 1) if seq[k:k + len(target)] == target]
    if not hits:
        raise YapError(f"could not find \"{snippet}\" in words {lo}–{hi}: {' '.join(w['text'] for w in words[lo:hi + 1])}")
    k = hits[-1] if last else hits[0]
    return lo + k, lo + k + len(target) - 1


def range_to_runs(rng: dict, phrases: dict[str, dict], order: list[str], words: list[dict],
                  max_pause: float | None, drop_fillers: bool) -> list[tuple[int, int]]:
    """Return runs of consecutive kept word indices [(w_first, w_last), …]."""
    p0 = phrases[rng["from"]]
    p1 = phrases[rng.get("to", rng["from"])]
    if p0["source"] != p1["source"]:
        raise YapError(f"range {rng['from']}–{rng.get('to')} crosses sources; split it")
    i0, i1 = order.index(p0["id"]), order.index(p1["id"])
    if i1 < i0:
        raise YapError(f"range {rng['from']}–{rng['to']} runs backwards")
    w0, w1 = p0["w0"], p1["w1"]
    if rng.get("start_at"):
        w0, _ = _find_snippet(words, p0["w0"], p0["w1"], rng["start_at"], last=False)
    if rng.get("end_after"):
        _, w1 = _find_snippet(words, p1["w0"], p1["w1"], rng["end_after"], last=True)
    skipped: set[int] = set()
    for pid in rng.get("skip", []):
        if pid not in phrases:
            raise YapError(f"skip: unknown phrase {pid}")
        sp = phrases[pid]
        skipped.update(range(sp["w0"], sp["w1"] + 1))
    keep = [i for i in range(w0, w1 + 1)
            if i not in skipped and not (drop_fillers and is_filler(words[i]["text"]))]
    runs: list[tuple[int, int]] = []
    for i in keep:
        if runs:
            a, b = runs[-1]
            contiguous = i == b + 1
            long_pause = (max_pause is not None and
                          words[i]["start"] - words[b]["end"] > pause_limit(words[b]["text"], max_pause))
            if contiguous and not long_pause:
                runs[-1] = (a, i)
                continue
        runs.append((i, i))
    return runs


def pause_limit(prev_word: str, max_pause: float) -> float:
    """How long a pause may run after this word before we tighten it."""
    if re.search(r"[.!?]$", prev_word):
        return max_pause                               # between sentences
    if re.search(r"[,;:]$", prev_word):
        return max(max_pause, CLAUSE_PAUSE)            # a comma breath
    return max(max_pause, MID_CLAUSE_PAUSE)            # mid-clause: part of the delivery


def split_on_silence(env, start, end, a, b, words, max_pause, thresh):
    """Whisper stretches words over pauses; trust the audio. Cut out silences
    longer than max_pause found inside a span, keeping a natural breath."""
    if max_pause is None:
        return [(start, end, a, b)]
    out = []
    cur = start
    for s0, s1 in silences(env, start + 0.05, end - 0.05, max_pause, thresh):
        # mid-clause pauses are part of the delivery; only tighten long ones there
        before = [i for i in range(a, b + 1) if words[i]["start"] < s0]
        if s1 - s0 < pause_limit(words[before[-1]]["text"] if before else ".", max_pause):
            continue
        keep_tail, keep_head = min(0.18, max_pause / 2), min(0.10, max_pause / 2)
        out.append((cur, s0 + keep_tail))
        cur = s1 - keep_head
    out.append((cur, end))
    # word indices: attribute words by midpoint so text and QC stay right
    spans = []
    for x0, x1 in out:
        idx = [i for i in range(a, b + 1) if x0 <= (words[i]["start"] + words[i]["end"]) / 2 <= x1]
        voiced = env[int(x0 / ENV_HOP):int(x1 / ENV_HOP)] > thresh
        if not idx and (len(voiced) == 0 or voiced.mean() < 0.3):
            continue  # a sliver of silence left over at an edge
        spans.append((x0, x1, idx[0] if idx else a, idx[-1] if idx else a - 1))
    return spans or [(start, end, a, b)]


def resolve(project: Project, version: str) -> dict:
    cut = project.cut_dir(version)
    edl_path = cut / "edl.json"
    if not edl_path.exists():
        raise YapError(f"no EDL at {edl_path}")
    edl = read_json(edl_path)
    plist = read_json(project.root / "phrases.json")
    phrases = {p["id"]: p for p in plist}
    order = [p["id"] for p in plist]
    max_pause = edl.get("max_pause", 0.6)
    drop_fillers = edl.get("drop_fillers", True)

    words_cache: dict[str, list[dict]] = {}
    env_cache: dict[str, np.ndarray] = {}
    thresh_cache: dict[str, float] = {}
    fps_by_src: dict[str, float] = {}
    segments: list[dict] = []
    settle = edl.get("settle_edges", True)          # move a cut edge to the real start/end of speech the transcript missed
    transcribers: dict[str, object] = {}
    edge_notes: list[str] = []

    for ri, rng in enumerate(edl["ranges"]):
        beat = rng.get("beat", "")
        if "from" in rng:
            if rng["from"] not in phrases or rng.get("to", rng["from"]) not in phrases:
                raise YapError(f"range {ri}: unknown phrase id")
            sid = phrases[rng["from"]]["source"]
            if rng.get("quote"):
                # guard against phrase ids shifting after a re-transcribe
                said = " ".join(norm(w) for w in phrases[rng["from"]]["words"])
                want = " ".join(n for n in (norm(w) for w in rng["quote"].split()) if n)
                if want not in said:
                    raise YapError(f"range {ri}: {rng['from']} no longer says \"{rng['quote']}\" "
                                   f"(it says \"{phrases[rng['from']]['text'][:60]}\") — phrase ids changed; update the EDL")
        else:
            sid = rng["source"]
        src = project.source(sid)
        fps = src.get("fps") or 25.0
        fps_by_src[sid] = fps
        if sid not in words_cache:
            words_cache[sid] = read_json(project.transcript_path(sid))["words"]
            env_cache[sid] = envelope(project, src)
            thresh_cache[sid] = levels(env_cache[sid])[2]
        words, env = words_cache[sid], env_cache[sid]

        if "from" in rng:
            runs = range_to_runs(rng, phrases, order, words, max_pause, drop_fillers)
            spans = []
            for a, b in runs:
                lo = words[a - 1]["end"] if a > 0 else 0.0
                hi = words[b + 1]["start"] if b + 1 < len(words) else src["duration"]
                start = max(lo, words[a]["start"] - HEAD_PAD)
                end = min(hi, words[b]["end"] + TAIL_PAD)
                # a long natural pause on either side: keep a little more breath
                if words[a]["start"] - lo > 0.6:
                    start = max(lo, words[a]["start"] - 0.12)
                if hi - words[b]["end"] > 0.6:
                    end = min(hi, words[b]["end"] + 0.22)
                start = snap(env, start, lo, words[a]["start"])
                end = snap(env, end, words[b]["end"], hi)
                if settle:
                    tr = transcribers.setdefault(sid, (sample_reader(project, src), slice_transcriber(project, src)))
                    label = f"range {ri}" + (f" ({beat})" if beat else "")
                    fix = settle_edge(env, words, start, "start", lo, words[a]["start"], tr[0], tr[1], outside=words[a - 1] if a > 0 else None)
                    if fix:
                        edge_notes.append(describe("start", fix, label))
                        start = fix["t"]
                    fix = settle_edge(env, words, end, "end", words[b]["end"], hi, tr[0], tr[1], outside=words[b + 1] if b + 1 < len(words) else None)
                    if fix:
                        edge_notes.append(describe("end", fix, label))
                        end = fix["t"]
                spans.extend(split_on_silence(env, start, end, a, b, words, max_pause, thresh_cache[sid]))
        else:
            spans = [(float(rng["start"]), float(rng["end"]), None, None)]

        for start, end, a, b in spans:
            # frame-align so audio and video lengths agree exactly
            start = round(start * fps) / fps
            end = round(end * fps) / fps
            if end - start < 1.0 / fps:
                continue
            if a is None:
                ws = [w for w in words if start <= (w["start"] + w["end"]) / 2 <= end]
                text = " ".join(w["text"] for w in ws)
            else:
                text = " ".join(w["text"] for w in words[a:b + 1]
                                if not (drop_fillers and is_filler(w["text"])))
                if b < a:
                    a = b = None
            segments.append({"source": sid, "start": round(start, 4), "end": round(end, 4),
                             "range": ri, "beat": beat, "text": text,
                             "w": [a, b] if a is not None else None,
                             "layout": rng.get("layout", "face")})

    # merge touching segments from the same source (no point in a join)
    merged: list[dict] = []
    for s in segments:
        if merged:
            m = merged[-1]
            if m["source"] == s["source"] and 0 <= s["start"] - m["end"] < 0.045 and m["range"] == s["range"]:
                m["end"] = s["end"]
                m["text"] = f"{m['text']} {s['text']}"
                if m["w"] and s["w"]:
                    m["w"] = [m["w"][0], s["w"][1]]
                continue
        merged.append(dict(s))

    # Jump cuts on a locked-off camera read as glitches; alternating a gentle
    # punch-in makes each one look deliberate.
    punch = edl.get("punch_in", PUNCH_IN)
    zoom = 1.0
    for k, s in enumerate(merged):
        if s["layout"] != "face":
            zoom = 1.0                        # the screen is on show; no punch-in
        elif k and punch and merged[k - 1]["source"] == s["source"] and merged[k - 1]["layout"] == "face":
            zoom = punch if zoom == 1.0 else 1.0
        else:
            zoom = 1.0
        s["zoom"] = zoom

    fmt = edl.get("format", {})
    out_w, out_h = fmt.get("width", 1920), fmt.get("height", 1080)
    notes: list[str] = list(edge_notes)
    if any(s["layout"] == "screen" for s in merged):
        if out_h > out_w:
            raise YapError("screen layout is 16:9 only for now (vertical split is next)")
        from .layout import place_screens
        notes += place_screens(project, edl, merged)

    if edl.get("reframe") == "face" or out_h > out_w:
        from .reframe import reframe_segments
        notes += reframe_segments(project, merged, out_w, out_h)

    if edl.get("parent"):
        notes += outside_parent(project, edl["parent"], merged)

    t = 0.0
    for s in merged:
        s["out_start"] = round(t, 4)
        t += s["end"] - s["start"]
        s["out_end"] = round(t, 4)

    fps_values = set(fps_by_src.values()) or {25.0}
    timeline = {
        "version": normalise_version(version),
        "width": fmt.get("width", 1920),
        "height": fmt.get("height", 1080),
        "fps": fmt.get("fps") or max(fps_values),
        "duration": round(t, 3),
        "parent": edl.get("parent"),
        "notes": notes,
        "segments": merged,
    }
    write_json(cut / "timeline.json", timeline)
    (cut / "script.md").write_text(script_md(edl, timeline))
    return timeline


def outside_parent(project: Project, parent: str, segments: list[dict]) -> list[str]:
    """A short may only use what the approved long cut uses."""
    ptl_path = project.cut_dir(parent) / "timeline.json"
    if not ptl_path.exists():
        return [f"parent {parent} has no timeline; resolve it first"]
    spans = [(p["source"], p["start"] - 0.3, p["end"] + 0.3) for p in read_json(ptl_path)["segments"]]
    out = []
    for s in segments:
        if not any(src == s["source"] and a <= s["start"] and s["end"] <= b for src, a, b in spans):
            out.append(f"uses {s['source']} {fmt_tc(s['start'])}–{fmt_tc(s['end'])}, which isn't in {parent}: "
                       f"\"{s['text'][:50]}\"")
    return out


def script_md(edl: dict, timeline: dict) -> str:
    lines = [f"# {timeline['version']} — {fmt_tc(timeline['duration'])}", ""]
    if edl.get("brief"):
        lines += [f"> {edl['brief']}", ""]
    cur = None
    for s in timeline["segments"]:
        beat = s["beat"] or f"range {s['range']}"
        if beat != cur:
            cur = beat
            lines += ["", f"**{beat}**", ""]
        lines.append(f"[{fmt_tc(s['out_start'])}] {s['text']}")
    return "\n".join(lines) + "\n"
