"""Listen to the finished render around every join.

The timeline says what *should* be at each cut. This re-listens to the render
itself and checks it: transcribe the rendered audio once, then at every join
confirm the words either side of the cut survived whole, none was said twice,
and the room sound and level carry across. Then it draws a sheet per join
(frames, waveform, words) for the agent, or you, to look at.

All findings are warnings: Whisper mishears, so a flag means "look at this
join", never "this is wrong". Writes cuts/vN/joins.md and cuts/vN/joins/.
"""

from __future__ import annotations

import subprocess
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from .levels import ENV_HOP
from .media import load_audio, rms_envelope
from .pack import norm
from .project import Project, YapError, fmt_tc, read_json, write_json

HEARD_FORMAT = 1
EDGE_WORDS = 3          # how many words either side of a join to compare
LISTEN = 1.5            # seconds of context either side of a join
FUZZY = 0.72            # how alike two spellings must be to count as the same word
TONE_JUMP_DB = 8.0
LEVEL_SPREAD_DB = 9.0     # a join is flagged when its level step is this far from the cut's typical step
LATE = 0.3                # Whisper's word times can land a little after the cut they belong before
EXTRA_NEAR = 0.3          # a word heard this close to a cut, that the script doesn't have, is a stray word
MISHEARD_BESIDE = 0.5     # ...unless a script word went unmatched this close to it (then it is a mishearing)
SILENT_DB = -80.0


# ---------------------------------------------------------------- listening

def heard_words(project: Project, render: Path, cut: Path, model: str | None = None) -> list[dict]:
    """Words Whisper hears in the rendered audio, cached against the render file."""
    from .transcribe import find_model, whisper_words
    st = render.stat()
    key = {"format": HEARD_FORMAT, "render": render.name, "size": st.st_size, "mtime": int(st.st_mtime)}
    cache = cut / f"heard.{render.stem}.json"
    if cache.exists():
        data = read_json(cache)
        if data.get("key") == key:
            return data["words"]
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "render.wav"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-nostdin", "-i", str(render), "-vn", "-ac", "1",
                            "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], capture_output=True, text=True)
        if r.returncode != 0:
            raise YapError(f"could not read the render's audio: {r.stderr[-400:]}")
        from .overlays import load_style
        names = ", ".join(sorted(set(load_style(project).get("spellings", {}).values())))
        words, _ = whisper_words(wav, find_model(model), names, render.name, verbatim=bool(names))
    write_json(cache, {"key": key, "words": words})
    return words


def _tokens(text: str) -> list[str]:
    return [t for t in (norm(w) for w in text.split()) if t]


def _alike(a: str, b: str) -> bool:
    return a == b or SequenceMatcher(None, a, b).ratio() >= FUZZY


def _clipped(expected: str, heard: str) -> bool:
    """`heard` is a broken-off piece of `expected` (\"ow\" for \"now\")."""
    return len(heard) >= 2 and len(expected) - len(heard) >= 2 and heard in expected


def edge_report(expected: list[str], heard: list[str], at_end: bool) -> dict:
    """Compare the expected words next to a join with what was heard there.

    `expected` and `heard` are in speaking order; the join is after the last
    word when `at_end`, before the first otherwise. Returns the boundary word's
    fate: ok / missing / clipped, plus how many of the edge words went missing."""
    edge = expected[-EDGE_WORDS:] if at_end else expected[:EDGE_WORDS]
    pool = list(heard)
    found, clipped, missing = [], [], []
    for tok in (reversed(edge) if at_end else edge):
        order = list(reversed(pool)) if at_end else list(pool)
        hit = next((h for h in order if h == tok), None)
        frag = None if hit is not None else next((h for h in order if _clipped(tok, h)), None)
        if hit is None and frag is None:
            hit = next((h for h in order if _alike(tok, h)), None)
        if hit is not None:
            pool.remove(hit)
            found.append(tok)
        elif frag is not None:
            pool.remove(frag)
            clipped.append(tok)
        else:
            missing.append(tok)
    boundary = edge[-1] if at_end else edge[0]
    state = "clipped" if boundary in clipped else "missing" if boundary in missing else "ok"
    # short words ("a", "the", "to") are the ones Whisper drops on its own: only trust a
    # missing boundary word when it is a real word, or when most of the edge is gone
    if state == "missing" and len(boundary) < 3 and len(missing) < 2:
        state = "ok"
    return {"state": state, "boundary": boundary, "missing": missing, "clipped": clipped,
            "edge": edge}


def heard_around(heard: list[dict], t0: float, t1: float) -> list[dict]:
    return [w for w in heard if t0 <= (w["start"] + w["end"]) / 2 <= t1]


def repeated_across(prev_heard: list[str], next_heard: list[str], exp_prev: list[str], exp_next: list[str]) -> str | None:
    """A word heard at the end of one side and again at the start of the other, when the
    script has it once: the join has played a sliver of the same word twice."""
    if not (prev_heard and next_heard and exp_prev and exp_next):
        return None
    if prev_heard[-1] == next_heard[0] and len(prev_heard[-1]) >= 3 and exp_prev[-1] != exp_next[0]:
        return prev_heard[-1]
    return None


def mid(w: dict) -> float:
    return (w["start"] + w["end"]) / 2


def extra_at_cut(heard: list[dict], meant: list[dict], t: float) -> list[str]:
    """Words heard right at a cut that the script doesn't have: a sliver of the next or
    previous word left in the join ("Hi, I'm Dan [and] today…").

    Heard and meant words around the cut are matched one for one. A word heard within
    EXTRA_NEAR of the cut with no partner is a stray, unless a script word went unmatched
    right beside it: then Whisper simply heard that word wrong ("fast" as "much cost"), and
    a mishearing is not a leak. A script word missing elsewhere (Whisper dropping a leading
    "Hi") does not excuse a stray."""
    h = [(norm(w["text"]), mid(w)) for w in heard if t - LISTEN <= mid(w) <= t + LISTEN and norm(w["text"])]
    m = [(norm(w["text"]), mid(w)) for w in meant if t - LISTEN - 0.4 <= mid(w) <= t + LISTEN + 0.4 and norm(w["text"])]
    free = list(range(len(m)))
    candidates = []
    for tok, at in h:
        hit = next((i for i in free if _alike(m[i][0], tok)), None)
        if hit is not None:
            free.remove(hit)
        elif abs(at - t) <= EXTRA_NEAR and len(tok) >= 2:
            candidates.append((tok, at))
    unmatched = [m[i][1] for i in free]
    return [tok for tok, at in candidates if not any(abs(at - u) <= MISHEARD_BESIDE for u in unmatched)]


# ------------------------------------------------------------------ room tone

def _env_db(audio: np.ndarray, sr: int) -> np.ndarray:
    return rms_envelope(audio, sr, hop=ENV_HOP, win=0.03)


def tone_across(env: np.ndarray, t: float) -> dict:
    """Room sound and speech level either side of a join, from a 10 ms envelope of the render.

    The room is measured only in the stretches between words (frames below the render's
    own speech threshold) and speech only on voiced frames, so a pause on one side is never
    compared with a word on the other. A big change in the room, or one side gone
    digital-silent, means the background changed or vanished at the cut."""
    from .levels import levels
    thresh = levels(env)[2]

    def frames(a: float, b: float) -> np.ndarray:
        return env[max(0, int(a / ENV_HOP)):max(0, int(b / ENV_HOP))]

    def room(a: float, b: float) -> float | None:
        q = frames(a, b)
        q = q[q < thresh]
        return float(np.median(q)) if len(q) >= 8 else None

    def speech(a: float, b: float) -> float | None:
        v = frames(a, b)
        v = v[v >= thresh]
        return float(np.median(v)) if len(v) >= 20 else None

    r0, r1 = room(t - 0.5, t - 0.02), room(t + 0.02, t + 0.5)
    s0, s1 = speech(t - 1.0, t), speech(t, t + 1.0)
    problems = []
    if r0 is not None and r1 is not None:
        if abs(r0 - r1) > TONE_JUMP_DB:
            problems.append(f"room sound changes at the cut ({r0:.0f} → {r1:.0f} dB between words)")
        elif (r0 < SILENT_DB) != (r1 < SILENT_DB):
            problems.append("the background drops to digital silence on one side of the cut")
    rnd = lambda x: None if x is None else round(x, 1)
    return {"floor_before": rnd(r0), "floor_after": rnd(r1), "level_before": rnd(s0), "level_after": rnd(s1),
            "problems": problems}


# --------------------------------------------------------------------- sheets

def _frame(render: Path, t: float, w: int, h: int):
    import cv2
    pr = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{max(0.0, t):.3f}", "-i", str(render),
                         "-frames:v", "1", "-vf", f"scale={w}:{h}", "-f", "image2pipe", "-c:v", "png", "-"],
                        capture_output=True)
    if not pr.stdout:
        return np.full((h, w, 3), 235, np.uint8)
    img = cv2.imdecode(np.frombuffer(pr.stdout, np.uint8), cv2.IMREAD_COLOR)
    return img if img is not None else np.full((h, w, 3), 235, np.uint8)


def _ascii(text: str) -> str:
    return text.encode("ascii", "replace").decode().replace("?", "'") if text else ""


def draw_sheet(render: Path, audio: np.ndarray, sr: int, t: float, heard: list[dict], meant: list[dict],
               vertical: bool, flags: list[str], title: str) -> np.ndarray:
    """One picture per join: six frames across the cut, the waveform, and the words
    heard against the words the cut meant to have."""
    import cv2
    tw, th = (126, 224) if vertical else (256, 144)
    offsets = [-1.0, -0.4, -0.04, 0.04, 0.4, 1.0]
    pad, W = 8, max(6 * 256 + 7 * 8, 6 * tw + 7 * 8)
    panels = [_frame(render, t + o, tw, th) for o in offsets]
    wave_h, lane_h = 120, 20
    head = 44
    H = head + th + 22 + wave_h + 2 * lane_h + 2 * pad + 16 + (len(flags) * 20)
    sheet = np.full((H, W, 3), 255, np.uint8)
    ink, grey, red = (28, 25, 23), (150, 150, 150), (60, 60, 230)
    cv2.putText(sheet, _ascii(title), (pad, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, ink, 1, cv2.LINE_AA)
    x0 = (W - (6 * tw + 5 * pad)) // 2
    for i, (o, im) in enumerate(zip(offsets, panels)):
        x = x0 + i * (tw + pad)
        sheet[head:head + th, x:x + tw] = im
        if abs(o) < 0.1:
            cv2.rectangle(sheet, (x, head), (x + tw - 1, head + th - 1), red, 2)
        cv2.putText(sheet, f"{o:+.2f}s", (x, head + th + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.42, grey, 1, cv2.LINE_AA)
    # waveform: min/max per pixel column across ±LISTEN seconds
    y0 = head + th + 22
    ww = W - 2 * pad
    a0 = int((t - LISTEN) * sr)
    seg = np.zeros(int(2 * LISTEN * sr), np.float32)
    lo, hi = max(0, a0), min(len(audio), a0 + len(seg))
    if hi > lo:
        seg[lo - a0:hi - a0] = audio[lo:hi]
    cols = np.array_split(seg, ww)
    mid = y0 + wave_h // 2
    peak = max(0.05, float(np.abs(seg).max()))
    for x, c in enumerate(cols):
        if len(c) == 0:
            continue
        top, bot = int(mid - c.max() / peak * (wave_h / 2 - 2)), int(mid - c.min() / peak * (wave_h / 2 - 2))
        cv2.line(sheet, (pad + x, top), (pad + x, max(bot, top + 1)), (120, 100, 90), 1)
    cx = pad + ww // 2
    cv2.line(sheet, (cx, y0), (cx, y0 + wave_h), red, 1)
    cv2.rectangle(sheet, (pad, y0), (pad + ww, y0 + wave_h), (220, 220, 220), 1)

    def lane(words: list[dict], y: int, label: str, colour) -> None:
        cv2.putText(sheet, label, (pad, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.38, grey, 1, cv2.LINE_AA)
        last = -1e9
        for w in words:
            m = (w["start"] + w["end"]) / 2
            if not t - LISTEN <= m <= t + LISTEN:
                continue
            x = pad + int((m - (t - LISTEN)) / (2 * LISTEN) * ww)
            txt = _ascii(w["text"])[:14]
            width = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)[0][0]
            x = max(pad + 44, x - width // 2)
            if x < last + 4:
                continue
            cv2.putText(sheet, txt, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.42, colour, 1, cv2.LINE_AA)
            last = x + width
    ly = y0 + wave_h + lane_h
    lane(meant, ly, "meant", (90, 140, 60))
    lane(heard, ly + lane_h, "heard", (200, 90, 40))
    for k, f in enumerate(flags):
        cv2.putText(sheet, _ascii(f)[:150], (pad, ly + 2 * lane_h + 22 + k * 20), cv2.FONT_HERSHEY_SIMPLEX, 0.46, red, 1, cv2.LINE_AA)
    return sheet


# ---------------------------------------------------------------------- main

def review(project: Project, version: str, lang: str | None = None, asr: bool = True,
           sheets: bool = True, model: str | None = None) -> dict:
    """Check every join of a rendered version. Returns {"warnings", "joins": [...]}; writes joins.md."""
    import cv2
    from .overlays import output_words
    cut = project.cut_dir(version)
    tl = read_json(cut / "timeline.json")
    render = project.render_path(version, lang=lang)
    if not render.exists():
        render = project.render_path(version, draft=True, lang=lang)
    if not render.exists():
        raise YapError(f"no render of {version} to listen to; run `yap-machine render {version}` first")
    segs = tl["segments"]
    vertical = tl["height"] > tl["width"]
    sr = 16000
    audio = load_audio(render, sr)
    env = _env_db(audio, sr)
    heard = heard_words(project, render, cut, model) if asr else None
    meant = output_words(project, tl)

    out_dir = cut / "joins"
    if sheets:
        if out_dir.exists():
            for old in out_dir.glob("join-*.png"):
                old.unlink()
        out_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    rows = []
    for k in range(1, len(segs)):
        a, b = segs[k - 1], segs[k]
        t = b["out_start"]
        flags: list[str] = []
        listen = None
        if heard is not None:
            exp_a, exp_b = _tokens(a["text"]), _tokens(b["text"])
            # each edge listens a little past the cut: DTW places some word ends late
            ha = heard_around(heard, t - LISTEN, t + LATE)
            hb = heard_around(heard, t - LATE, t + LISTEN)
            ha_t, hb_t = [norm(w["text"]) for w in ha if norm(w["text"])], [norm(w["text"]) for w in hb if norm(w["text"])]
            # a word belongs to the side its middle falls on, for the repeat check
            pa = [norm(w["text"]) for w in heard_around(heard, t - LISTEN, t - 1e-6) if norm(w["text"])]
            pb = [norm(w["text"]) for w in heard_around(heard, t, t + LISTEN) if norm(w["text"])]
            exp_a = [w for w in exp_a if w][-6:]
            exp_b = [w for w in exp_b if w][:6]
            if exp_a:
                r = edge_report(exp_a, ha_t, at_end=True)
                if r["state"] != "ok":
                    flags.append(f"end of the line before the cut: \"{r['boundary']}\" {r['state']}"
                                 + (f" (heard: {' '.join(ha_t[-4:])})" if ha_t else " (nothing heard)"))
            if exp_b:
                r = edge_report(exp_b, hb_t, at_end=False)
                if r["state"] != "ok":
                    flags.append(f"start of the line after the cut: \"{r['boundary']}\" {r['state']}"
                                 + (f" (heard: {' '.join(hb_t[:4])})" if hb_t else " (nothing heard)"))
            dup = repeated_across(pa, pb, exp_a, exp_b)
            if dup:
                flags.append(f"\"{dup}\" is heard on both sides of the cut but meant once")
            stray = [x for x in extra_at_cut(heard, meant, t) if x != dup]
            if stray:
                flags.append(f"an extra word is heard at the cut: \"{' '.join(stray)}\" (the script doesn't have it)")
            listen = {"before": " ".join(ha_t[-5:]), "after": " ".join(hb_t[:5])}
        tone = tone_across(env, t)
        flags += tone["problems"]
        row = {"n": k, "at": round(t, 3), "tc": fmt_tc(t), "flags": flags, "tone": tone, "listen": listen,
               "out_of": " ".join(a["text"].split()[-4:]), "into": " ".join(b["text"].split()[:4]), "sheet": None}
        if sheets:
            name = f"join-{k:03d}.png"
            img = draw_sheet(render, audio, sr, t, [w for w in (heard or []) if abs(w["start"] - t) < 2 * LISTEN],
                             [w for w in meant if abs(w["start"] - t) < 2 * LISTEN], vertical, flags,
                             f"{version} join {k}  at {fmt_tc(t)}")
            cv2.imwrite(str(out_dir / name), img)
            row["sheet"] = f"joins/{name}"
        for f in flags:
            warnings.append(f"{fmt_tc(t)} join: {f}")
        rows.append(row)

    # speech tends to fall away at the end of a sentence and start strong, so a level step
    # is only worth a look when it is unusual *for this cut*
    steps = [(r, r["tone"]["level_after"] - r["tone"]["level_before"]) for r in rows
             if r["tone"]["level_before"] is not None and r["tone"]["level_after"] is not None]
    if len(steps) >= 5:
        typical = float(np.median([d for _, d in steps]))
        for r, d in steps:
            if abs(d - typical) > LEVEL_SPREAD_DB:
                f = f"speech level steps {d:+.0f} dB here, against {typical:+.0f} dB at a typical join"
                r["flags"].append(f)
                warnings.append(f"{r['tc']} join: {f}")
    flagged = [r for r in rows if r["flags"]]
    measured = sum(1 for r in rows if r["tone"]["floor_before"] is not None and r["tone"]["floor_after"] is not None)
    lines = [f"# Joins — {version}", "",
             f"{len(rows)} joins in {render.name}. " + ("Re-listened to the render with Whisper, and checked the room sound either side. "
                                                          if asr else "Room sound checked; the render was not re-transcribed. ")
             + f"**{len(flagged)} flagged.** A flag means look, not wrong: Whisper mishears. "
             f"(Room sound could be compared at {measured} of {len(rows)} joins; the rest cut tight on a word, with no pause either side to measure.)", "",
             "| # | at | out of | into | heard either side | flags | sheet |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        hear = f"…{r['listen']['before']} │ {r['listen']['after']}…" if r["listen"] else ""
        lines.append(f"| {r['n']} | {r['tc']} | …{r['out_of']} | {r['into']}… | {hear} | "
                     f"{'; '.join(r['flags']) or '·'} | {r['sheet'] or ''} |")
    (cut / "joins.md").write_text("\n".join(lines) + "\n")
    write_json(cut / "joins.json", {"version": version, "render": render.name, "asr": asr, "joins": rows})
    return {"warnings": warnings, "joins": rows, "flagged": len(flagged)}
