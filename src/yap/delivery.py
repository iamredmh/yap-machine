"""How it was said, in numbers.

`takes.md` says *what* was said. This measures *how*: pace, filler rate, pauses,
and level, so the agent can choose between attempts at the same line on more
than the words, and the speaker can see where they rushed or rambled.

Measurements only. A fast take is not a bad one; the agent (and the person's
ear) decide. Writes delivery.md for the whole recording, and, given a version,
cuts/vN/delivery.md for the cut that was made.
"""

from __future__ import annotations

from statistics import median

from .pack import is_filler, norm
from .project import Project, fmt_tc, read_json, write_json

LONG_PAUSE = 1.0
MIN_WORDS = 4          # a phrase needs this many words for its pace to mean anything
BLOCK = 60.0           # seconds per row in the pacing-over-time table


def wpm(words: int, seconds: float) -> float | None:
    return int(round(words * 60.0 / seconds)) if seconds > 0.3 and words >= 2 else None


def _groups(phrases: list[dict]) -> list[list[dict]]:
    """Connected sets of phrases linked as attempts at the same line."""
    by_id = {p["id"]: p for p in phrases}
    seen: set[str] = set()
    out = []
    for p in phrases:
        if p["id"] in seen or not p.get("alts"):
            continue
        stack, comp = [p["id"]], []
        while stack:
            i = stack.pop()
            if i in seen or i not in by_id:
                continue
            seen.add(i)
            comp.append(by_id[i])
            stack.extend(by_id[i].get("alts", []))
        if len(comp) > 1:
            out.append(sorted(comp, key=lambda x: (x["source"], x["start"])))
    return out


def phrase_stats(project: Project, phrases: list[dict]) -> list[dict]:
    """Per phrase: pace over the words actually spoken, fillers, pause before."""
    words = {}
    out = []
    prev_end: dict[str, float] = {}
    for p in phrases:
        if p["source"] not in words:
            words[p["source"]] = read_json(project.transcript_path(p["source"]))["words"]
        ws = words[p["source"]][p["w0"]:p["w1"] + 1]
        content = [w for w in ws if not is_filler(w["text"])]
        out.append({
            "id": p["id"], "source": p["source"], "start": p["start"], "end": p["end"],
            "words": len(content), "fillers": len(ws) - len(content),
            "wpm": wpm(len(content), p["end"] - p["start"]),
            "pause_before": round(p["start"] - prev_end[p["source"]], 2) if p["source"] in prev_end else None,
            "level_db": p.get("level_db"), "conf": p.get("conf"), "flags": p["flags"],
        })
        prev_end[p["source"]] = p["end"]
    return out


def summarise(stats: list[dict]) -> dict:
    """Recording-wide numbers from phrase stats."""
    paces = [s["wpm"] for s in stats if s["wpm"] and s["words"] >= MIN_WORDS]
    words = sum(s["words"] for s in stats)
    fillers = sum(s["fillers"] for s in stats)
    pauses = [s["pause_before"] for s in stats if s["pause_before"] is not None and s["pause_before"] >= LONG_PAUSE]
    return {
        "wpm_typical": round(median(paces)) if paces else None,
        "wpm_range": [round(min(paces)), round(max(paces))] if paces else None,
        "words": words, "fillers": fillers,
        "fillers_per_100": round(100 * fillers / max(1, words + fillers), 1),
        "long_pauses": len(pauses), "longest_pause": round(max(pauses), 1) if pauses else 0.0,
    }


def pacing_over_time(stats: list[dict], block: float = BLOCK) -> list[dict]:
    rows: dict[int, list[dict]] = {}
    for s in stats:
        rows.setdefault(int(s["start"] // block), []).append(s)
    out = []
    for k in sorted(rows):
        ss = rows[k]
        w = sum(s["words"] for s in ss)
        talk = sum(s["end"] - s["start"] for s in ss)
        out.append({"at": k * block, "words": w, "wpm": wpm(w, talk),
                    "fillers": sum(s["fillers"] for s in ss),
                    "pauses": sum(1 for s in ss if (s["pause_before"] or 0) >= LONG_PAUSE)})
    return out


def attempt_tables(stats: list[dict], phrases: list[dict], typical: int | None) -> list[str]:
    by_id = {s["id"]: s for s in stats}
    lines = []
    for g in _groups(phrases):
        if not any(by_id[p["id"]]["words"] >= MIN_WORDS for p in g):
            continue
        lines += [f"**{' / '.join(p['id'] for p in g)}** — “{' '.join(g[-1]['text'].split()[:9])}…”", "",
                  "| phrase | at | pace | vs typical | fillers | level | confidence | flags |", "|---|---|---|---|---|---|---|---|"]
        for p in g:
            s = by_id[p["id"]]
            rel = f"{s['wpm'] - typical:+.0f}" if s["wpm"] and typical else ""
            lvl = f"{s['level_db']:+.0f} dB" if s["level_db"] is not None else ""
            flags = " ".join(("retake→" + p["retake_of"]) if f == "retake" else f for f in p["flags"])
            lines.append(f"| {p['id']} | {fmt_tc(p['start'])} | {s['wpm'] or ''} wpm | {rel} | {s['fillers'] or ''} | {lvl} | "
                         f"{s['conf']} | {flags} |")
        lines.append("")
    return lines


def write(project: Project, phrases: list[dict]) -> dict:
    """delivery.md / delivery.json for the whole recording (run by `yap-machine prep`)."""
    stats = phrase_stats(project, phrases)
    data = project.load()
    lines = ["# Delivery", "",
             "How it was said, measured from the transcript and audio. Numbers narrow the choice; your ear decides.",
             "Pace is words per minute while speaking (pauses between phrases excluded). Level is against the speaker's typical level.", ""]
    all_sum = {}
    for src in data["sources"]:
        ss = [s for s in stats if s["source"] == src["id"]]
        if not ss:
            continue
        sm = summarise(ss)
        all_sum[src["id"]] = sm
        pace = (f"Typical pace **{sm['wpm_typical']} wpm** (phrases ran {sm['wpm_range'][0]}–{sm['wpm_range'][1]})"
                if sm["wpm_range"] else "Not enough speech to measure typical pace")
        lines += [f"## {src['id']}", "",
                  f"- {pace}; "
                  f"{sm['words']} words, {sm['fillers']} fillers ({sm['fillers_per_100']} per 100 words)",
                  f"- {sm['long_pauses']} pauses of {LONG_PAUSE:.0f}s or more, longest {sm['longest_pause']}s", "",
                  "| minute | words | pace | fillers | long pauses |", "|---|---|---|---|---|"]
        for r in pacing_over_time(ss):
            lines.append(f"| {fmt_tc(r['at'])[:5]} | {r['words']} | {r['wpm'] or ''} wpm | {r['fillers'] or ''} | {r['pauses'] or ''} |")
        lines.append("")
        ps = [p for p in phrases if p["source"] == src["id"]]
        tables = attempt_tables(ss, ps, sm["wpm_typical"])
        if tables:
            lines += ["### Attempts at the same line", "", *tables]
    (project.root / "delivery.md").write_text("\n".join(lines) + "\n")
    write_json(project.root / "delivery.json", {"sources": all_sum, "phrases": stats})
    return {"sources": all_sum, "phrases": stats}


def cut_report(project: Project, version: str) -> dict:
    """Pace and pauses of a made cut: per beat and overall, from its timeline."""
    cut = project.cut_dir(version)
    tl = read_json(cut / "timeline.json")
    beats: dict[str, dict] = {}
    total_words = total_talk = 0
    for s in tl["segments"]:
        n = len([w for w in s["text"].split() if norm(w)])
        dur = s["end"] - s["start"]
        b = beats.setdefault(s.get("beat") or f"range {s['range']}", {"words": 0, "seconds": 0.0, "at": s["out_start"]})
        b["words"] += n
        b["seconds"] += dur
        total_words += n
        total_talk += dur
    rows = [{"beat": k, "at": round(v["at"], 2), "seconds": round(v["seconds"], 1),
             "wpm": wpm(v["words"], v["seconds"])} for k, v in beats.items()]
    overall = wpm(total_words, total_talk)
    lines = [f"# Delivery of {version}", "",
             f"{fmt_tc(tl['duration'])} long, {total_words} words, **{overall} wpm** over the whole cut, {len(tl['segments'])} segments.", "",
             "| beat | at | length | pace |", "|---|---|---|---|"]
    lines += [f"| {r['beat']} | {fmt_tc(r['at'])} | {r['seconds']}s | {r['wpm'] or ''} wpm |" for r in rows]
    (cut / "delivery.md").write_text("\n".join(lines) + "\n")
    return {"overall_wpm": overall, "words": total_words, "beats": rows}
