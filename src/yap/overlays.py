"""Captions and lower thirds, burned in with libass (ffmpeg's subtitle renderer).

Everything is laid out from the resolved timeline, so captions follow the
words exactly as they are heard in the cut.

  style     packaged presets + the project's style.json (brand colours, fonts)
  people    people.json in the project: [{"id", "name", "title"}]
  EDL       "captions": true | {"preset": "short", "language": "es"}
            "lower_thirds": [{"person": "red", "at": 1.0, "duration": 4.5}]
            (or "at": "P017" to land on the first time that phrase is heard)

Writes next to the timeline:
  overlay.ass        what gets burned in
  captions.srt       plain captions for uploading to YouTube/LinkedIn
  captions.json      the caption groups as burned [{start, end, text}]
  translate.json     whole sentences [{start, end, text}] — translate each "text" into
                     captions.<lang>.json (same start/end), then `yap-machine render vN --lang <lang>`
"""

from __future__ import annotations

import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from .pack import is_filler
from .project import Project, YapError, fmt_tc, read_json, write_json

# -------- presets --------------------------------------------------------------

PRESETS: dict[str, dict] = {
    # bold, few words at a time, the spoken word lights up (vertical shorts)
    "short": {
        "font": "Inter ExtraBold", "size": 0.076, "color": "#FFFFFF", "active": "accent",
        "outline": 0.0055, "shadow": 0.004, "max_words": 3, "max_chars": 16,
        "y": 0.72, "case": "none", "highlight": True, "lines": 1,
    },
    # calmer sentence captions for long form (16:9)
    "long": {
        "font": "Inter SemiBold", "size": 0.048, "color": "#FFFFFF", "active": None,
        "outline": 0.0035, "shadow": 0.003, "max_words": 9, "max_chars": 42,
        "y": 0.90, "case": "none", "highlight": False, "lines": 2,
    },
}

LOWER_THIRD = {
    "name_font": "Inter Bold", "title_font": "Inter Medium",
    "name_size": 0.040, "title_size": 0.026,     # fractions of the shorter frame side
    "card": "#FFFFFF", "card_alpha": 0.06,         # 0 = solid
    "ink": "#1C1917", "muted": "#57534E", "accent": "accent",
    "x": 0.06, "y": {"wide": 0.70, "tall": 0.58},  # top of the card, fraction of height
    "in": 0.28, "out": 0.32, "slide": 0.02,
}

DEFAULT_STYLE = {"accent": "#F0412B"}
TALL_CAPTION_MAX_Y = 0.84   # phone UI (caption, buttons) covers the bottom of a vertical video
FACE_GAP = 0.025            # space between chin and the next overlay, fraction of height


def load_style(project: Project) -> dict:
    p = project.root / "style.json"
    style = dict(DEFAULT_STYLE)
    if p.exists():
        style.update(read_json(p))
    return style


def resolve_caption_style(project: Project, timeline: dict, spec) -> dict:
    tall = timeline["height"] > timeline["width"]
    preset = (spec.get("preset") if isinstance(spec, dict) else None) or ("short" if tall else "long")
    if preset not in PRESETS:
        raise YapError(f"unknown caption preset '{preset}' (have: {', '.join(PRESETS)})")
    style = load_style(project)
    cs = {**PRESETS[preset], **style.get("captions", {}).get(preset, {})}
    if isinstance(spec, dict):
        cs.update({k: v for k, v in spec.items() if k in cs})
    if cs.get("active") == "accent":
        cs["active"] = style["accent"]
    # Share face-aware placement between libass, the live player and the
    # compositor fallback. Previously only the libass file was adjusted.
    face_bottoms = [s.get("face_bottom") for s in timeline.get("segments", []) if s.get("face_bottom")]
    if tall and face_bottoms:
        size = cs["size"] * timeline["width"]
        need = max(face_bottoms) + FACE_GAP + cs["lines"] * size * 1.2 / timeline["height"]
        cs["y"] = round(min(max(cs["y"], need), TALL_CAPTION_MAX_Y), 4)
    return cs


# -------- colours & fonts -------------------------------------------------------

def ass_color(hex_rgb: str, alpha: float = 0.0) -> str:
    """#RRGGBB → &HAABBGGRR (ASS alpha: 00 opaque, FF transparent)."""
    h = hex_rgb.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{int(round(alpha * 255)):02X}{b}{g}{r}".upper()


@lru_cache(maxsize=None)
def _font_file(name: str) -> str | None:
    if not shutil.which("fc-match"):
        return None
    out = subprocess.run(["fc-match", "-f", "%{file}", name], capture_output=True, text=True).stdout.strip()
    return out or None


@lru_cache(maxsize=None)
def _font_metrics(name: str):
    path = _font_file(name)
    if not path:
        return None
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(path, lazy=True)
        return f.getBestCmap(), f["hmtx"].metrics, f["head"].unitsPerEm
    except Exception:
        return None


def text_width(text: str, font: str, size_px: float) -> float:
    """Advance width of text in pixels (falls back to an estimate)."""
    m = _font_metrics(font)
    if not m:
        return len(text) * size_px * 0.58
    cmap, hmtx, upem = m
    total = 0
    for ch in text:
        glyph = cmap.get(ord(ch))
        total += hmtx[glyph][0] if glyph in hmtx else upem * 0.55
    return total * size_px / upem


# -------- words on the output timeline ------------------------------------------

def respell(text: str, spellings: dict[str, str]) -> str:
    """Fix brand and name spellings Whisper gets wrong ("acme" → "Acme"),
    whole words only, keeping any punctuation around them."""
    m = re.match(r"^(\W*)(.*?)(\W*)$", text)
    lead, core, trail = m.groups() if m else ("", text, "")
    fixed = spellings.get(core.lower())
    return f"{lead}{fixed}{trail}" if fixed else text


def output_words(project: Project, timeline: dict) -> list[dict]:
    cache: dict[str, list] = {}
    spellings = {k.lower(): v for k, v in load_style(project).get("spellings", {}).items()}
    out = []
    for s in timeline["segments"]:
        if s["source"] not in cache:
            cache[s["source"]] = read_json(project.transcript_path(s["source"]))["words"]
        for w in cache[s["source"]]:
            mid = (w["start"] + w["end"]) / 2
            if not (s["start"] <= mid <= s["end"]) or is_filler(w["text"]):
                continue
            a = max(w["start"], s["start"]) - s["start"] + s["out_start"]
            b = min(w["end"], s["end"]) - s["start"] + s["out_start"]
            out.append({"text": respell(w["text"], spellings), "start": round(a, 3),
                        "end": round(max(b, a + 0.05), 3)})
    return out


def group_captions(words: list[dict], max_words: int, max_chars: int) -> list[list[dict]]:
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur:
            text = " ".join(x["text"] for x in cur + [w])
            sentence_end = re.search(r"[.!?]$", cur[-1]["text"]) is not None
            gap = w["start"] - cur[-1]["end"] > 0.5
            if len(cur) >= max_words or len(text) > max_chars or sentence_end or gap:
                groups.append(cur)
                cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    # don't leave a lonely last word if it can join the previous group
    if len(groups) >= 2 and len(groups[-1]) == 1 and not re.search(r"[.!?]$", groups[-2][-1]["text"]):
        if len(" ".join(x["text"] for x in groups[-2] + groups[-1])) <= max_chars + 6:
            groups[-2] += groups.pop()
    return groups


def sentences(words: list[dict], max_len: float = 9.0) -> list[dict]:
    """Whole sentences on the output timeline, the unit a translator needs."""
    out, cur = [], []
    for w in words:
        if cur and w["start"] - cur[-1]["end"] > 1.0:
            out.append(cur)
            cur = []
        elif cur and w["end"] - cur[0]["start"] > max_len:
            # too long for one caption run: break after the last comma, if there is one
            commas = [i for i, x in enumerate(cur) if x["text"].endswith(",")]
            k = commas[-1] + 1 if commas and commas[-1] > 0 else len(cur)
            out.append(cur[:k])
            cur = cur[k:]
        cur.append(w)
        if re.search(r"[.!?]$", w["text"]):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [{"start": g[0]["start"], "end": g[-1]["end"], "text": " ".join(w["text"] for w in g)} for g in out]


def split_translation(items: list[dict], max_words: int, max_chars: int) -> list[dict]:
    """Break each translated sentence into caption-sized chunks, timed by length."""
    out = []
    for it in items:
        words, chunks, cur = it["text"].split(), [], []
        for w in words:
            if cur and (len(cur) >= max_words or len(" ".join(cur + [w])) > max_chars):
                chunks.append(" ".join(cur))
                cur = []
            cur.append(w)
        if cur:
            chunks.append(" ".join(cur))
        total = sum(len(c) + 1 for c in chunks) or 1
        t = it["start"]
        span = it["end"] - it["start"]
        for c in chunks:
            d = span * (len(c) + 1) / total
            out.append({"start": round(t, 3), "end": round(t + d, 3), "text": c})
            t += d
    return out


def _case(text: str, mode: str) -> str:
    return text.upper() if mode == "upper" else text.lower() if mode == "lower" else text


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def _ts(t: float) -> str:
    cs = max(0, int(round(t * 100)))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


# -------- lower thirds ------------------------------------------------------------

def _rounded_rect(w: float, h: float, r: float) -> str:
    k = r * 0.4477  # bezier handle for a quarter circle
    return (f"m {r} 0 l {w - r} 0 b {w - k} 0 {w} {k} {w} {r} l {w} {h - r} "
            f"b {w} {h - k} {w - k} {h} {w - r} {h} l {r} {h} b {k} {h} 0 {h - k} 0 {h - r} "
            f"l 0 {r} b 0 {k} {k} 0 {r} 0")


def lower_third_events(lt: dict, person: dict, W: int, H: int, accent: str,
                       place: dict | None = None, compact: bool = False) -> tuple[list[str], dict]:
    """compact: a smaller card in the top-left corner, for vertical shots with
    no room between the speaker's chin and the captions."""
    cfg = dict(LOWER_THIRD)
    tall = H > W
    unit = min(W, H)
    k = 1.15 if compact else (1.5 if tall else 1.0)   # phones: a name card has to read at arm's length
    ns, ts_ = cfg["name_size"] * unit * k, cfg["title_size"] * unit * k
    pad_x, pad_y, gap, bar = 0.9 * ts_, 0.55 * ts_, 0.25 * ts_, max(4, round(0.006 * unit))
    name_w = text_width(person["name"], cfg["name_font"], ns)
    title_w = text_width(person.get("title", ""), cfg["title_font"], ts_) if person.get("title") else 0
    cw = round(bar + pad_x * 2 + max(name_w, title_w))
    ch = round(pad_y * 2 + ns * 1.05 + (gap + ts_ * 1.1 if title_w else 0))
    x1 = round((cfg["x"] if not tall or compact else (1 - cw / W) / 2) * W)
    y = round((0.035 if compact else cfg["y"]["tall" if tall else "wide"]) * H)
    if place:
        # between the chin and the captions if it fits; otherwise above the head
        if place["below"] * H + ch <= place["above"] * H:
            y = round(place["below"] * H)
        else:
            return lower_third_events(lt, person, W, H, accent, None, compact=True)
    x0 = x1 - round(cfg["slide"] * W)
    t0, t1 = float(lt["at"]), float(lt["at"]) + float(lt.get("duration", 4.5))
    ms_in, ms_out = int(cfg["in"] * 1000), int(cfg["out"] * 1000)
    acc = ass_color(accent if cfg["accent"] == "accent" else cfg["accent"])
    mv = f"\\move({x0},{y},{x1},{y},0,{ms_in})"
    fade = f"\\fad({ms_in},{ms_out})"
    bx, by = round(pad_x * 0.45), round(pad_y * 0.8)
    bar_mv = f"\\move({x0 + bx},{y + by},{x1 + bx},{y + by},0,{ms_in})"
    ev = [
        f"Dialogue: 5,{_ts(t0)},{_ts(t1)},LT,,0,0,0,,{{\\an7{mv}{fade}\\p1\\bord{max(1, round(unit / 540))}\\shad0"
        f"\\3c{ass_color('#D6D3D1')}"
        f"\\1c{ass_color(cfg['card'])}\\1a&H{int(cfg['card_alpha'] * 255):02X}&}}{_rounded_rect(cw, ch, ch * 0.18)}{{\\p0}}",
        f"Dialogue: 6,{_ts(t0)},{_ts(t1)},LT,,0,0,0,,{{\\an7{bar_mv}{fade}\\p1\\bord0\\shad0\\1c{acc}}}"
        f"{_rounded_rect(bar, ch - 2 * by, bar / 2)}{{\\p0}}",
        f"Dialogue: 7,{_ts(t0)},{_ts(t1)},LTName,,0,0,0,,{{\\an7\\move({x0 + bar + pad_x:.0f},{y + pad_y:.0f},"
        f"{x1 + bar + pad_x:.0f},{y + pad_y:.0f},0,{ms_in}){fade}\\fs{ns:.0f}}}{_esc(person['name'])}",
    ]
    if title_w:
        ty = y + pad_y + ns * 1.05 + gap
        ev.append(f"Dialogue: 7,{_ts(t0)},{_ts(t1)},LTTitle,,0,0,0,,{{\\an7\\move({x0 + bar + pad_x},{ty:.0f},"
                  f"{x1 + bar + pad_x},{ty:.0f},0,{ms_in}){fade}\\fs{ts_:.0f}}}{_esc(person['title'])}")
    box = {"t0": t0, "t1": t1, "x": x1, "y": y, "w": cw, "h": ch}
    return ev, box


# -------- build ---------------------------------------------------------------------

def build(project: Project, version: str, timeline: dict, edl: dict, lang: str | None = None) -> Path | None:
    """Write overlay.ass (+ captions.srt/json) for a version. None if nothing to draw."""
    cut = project.cut_dir(version)
    W, H = timeline["width"], timeline["height"]
    spec = edl.get("captions")
    lts = edl.get("lower_thirds") or []
    if not spec and not lts:
        for f in ("overlay.ass", "layout.json"):
            (cut / f).unlink(missing_ok=True)
        return None
    style = load_style(project)
    events: list[str] = []
    layout: dict = {"captions": [], "lower_thirds": []}

    cs = dict(resolve_caption_style(project, timeline, spec) if spec else PRESETS["long"])
    size = cs["size"] * (W if H > W else H)
    tall = H > W
    words = output_words(project, timeline)
    groups = group_captions(words, cs["max_words"], cs["max_chars"])
    plain = []
    for i, g in enumerate(groups):
        end = groups[i + 1][0]["start"] if i + 1 < len(groups) else g[-1]["end"] + 0.4
        end = min(end, g[-1]["end"] + 0.8)
        plain.append({"start": g[0]["start"], "end": round(end, 3), "text": " ".join(w["text"] for w in g)})
    if not lang:
        write_json(cut / "captions.json", plain)
        (cut / "captions.srt").write_text(_srt(plain))
        write_json(cut / "translate.json", sentences(words))

    if spec:
        lang = spec.get("language") if isinstance(spec, dict) else None
        if lang and lang != "en":
            tr = cut / f"captions.{lang}.json"
            if not tr.exists():
                raise YapError(f"no translation at {tr}: translate each sentence in translate.json "
                               "into it (same start/end, new text)")
            items = split_translation(read_json(tr), cs["max_words"], cs["max_chars"])
            for it in items:
                events.append(f"Dialogue: 1,{_ts(it['start'])},{_ts(it['end'])},Cap,,0,0,0,,"
                              f"{_esc(_case(it['text'], cs['case']))}")
                layout["captions"].append({"t0": it["start"], "t1": it["end"], "text": it["text"]})
            (cut / f"captions.{lang}.srt").write_text(_srt(read_json(tr)))
        else:
            active = ass_color(cs["active"]) if cs.get("active") else None
            for i, g in enumerate(groups):
                g_end = plain[i]["end"]
                layout["captions"].append({"t0": g[0]["start"], "t1": g_end, "text": plain[i]["text"]})
                if cs["highlight"] and active:
                    for k, w in enumerate(g):
                        t0 = w["start"] if k else g[0]["start"]
                        t1 = g[k + 1]["start"] if k + 1 < len(g) else g_end
                        parts = [(f"{{\\1c{active}}}{_esc(_case(x['text'], cs['case']))}{{\\1c{ass_color(cs['color'])}}}"
                                  if j == k else _esc(_case(x["text"], cs["case"]))) for j, x in enumerate(g)]
                        events.append(f"Dialogue: 1,{_ts(t0)},{_ts(t1)},Cap,,0,0,0,,{' '.join(parts)}")
                else:
                    events.append(f"Dialogue: 1,{_ts(g[0]['start'])},{_ts(g_end)},Cap,,0,0,0,,"
                                  f"{_esc(_case(plain[i]['text'], cs['case']))}")
        layout["caption_box"] = {"y": cs["y"], "size": size, "lines": cs["lines"], "font": cs["font"],
                                 "max_width": 0.84 * W}

    people = {p["id"]: p for p in (read_json(project.root / "people.json") if (project.root / "people.json").exists() else [])}
    for lt in lts:
        if lt["person"] not in people:
            raise YapError(f"lower third: no person '{lt['person']}' in people.json")
        at = lt.get("at", 0.8)
        if isinstance(at, str):                  # a phrase id: first time it's heard in the cut
            at = _phrase_time(project, timeline, at)
        place = None
        if tall:
            seg = next((x for x in timeline["segments"] if x["out_start"] <= at < x["out_end"]), timeline["segments"][0])
            cap_top = cs["y"] - cs["lines"] * size * 1.2 / H if spec else TALL_CAPTION_MAX_Y
            place = {"below": (seg.get("face_bottom") or 0.6) + FACE_GAP, "above": cap_top - 0.01}
        ev, box = lower_third_events({**lt, "at": at}, people[lt["person"]], W, H, style["accent"], place)
        events += ev
        layout["lower_thirds"].append(box)

    margin_v = round((1 - cs["y"]) * H)
    header = "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "YCbCr Matrix: TV.709", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: Cap,{cs['font']},{size:.0f},{ass_color(cs['color'])},&H000000FF,{ass_color('#000000', 0.25)},"
        f"{ass_color('#000000', 0.55)},0,0,0,0,100,100,0,0,1,{cs['outline'] * min(W, H) * 1.6:.1f},"
        f"{cs['shadow'] * min(W, H) * 1.6:.1f},2,{round(0.08 * W)},{round(0.08 * W)},{margin_v},1",
        f"Style: LT,Inter,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        f"Style: LTName,{LOWER_THIRD['name_font']},40,{ass_color(LOWER_THIRD['ink'])},&H000000FF,&H00000000,"
        f"&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        f"Style: LTTitle,{LOWER_THIRD['title_font']},28,{ass_color(LOWER_THIRD['muted'])},&H000000FF,&H00000000,"
        f"&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    sfx = f".{lang}" if lang else ""
    ass = cut / f"overlay{sfx}.ass"
    ass.write_text(header + "\n" + "\n".join(events) + "\n")
    write_json(cut / f"layout{sfx}.json", layout)
    return ass


def _phrase_time(project: Project, timeline: dict, pid: str) -> float:
    phrases = {p["id"]: p for p in read_json(project.root / "phrases.json")}
    if pid not in phrases:
        raise YapError(f"lower third: unknown phrase {pid}")
    p = phrases[pid]
    for s in timeline["segments"]:
        if s["source"] == p["source"] and s["start"] - 0.05 <= p["start"] <= s["end"]:
            return round(p["start"] - s["start"] + s["out_start"], 3)
    raise YapError(f"lower third: {pid} isn't heard in this cut")


def _srt(items: list[dict]) -> str:
    def t(x):
        ms = int(round(x * 1000))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    return "\n".join(f"{i}\n{t(c['start'])} --> {t(c['end'])}\n{c['text']}\n" for i, c in enumerate(items, 1))


def caption_lines(text: str, font: str, size: float, max_width: float) -> int:
    """How many lines libass will need for this caption."""
    lines, cur = 1, ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if cur and text_width(trial, font, size) > max_width:
            lines += 1
            cur = word
        else:
            cur = trial
    return lines
