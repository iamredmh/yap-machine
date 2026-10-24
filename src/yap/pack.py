"""Turn word-level transcripts into numbered phrases the editing agent can read.

Each phrase gets an id (P001…), source-time range, text and flags:
  retake   a later phrase starts the same line again — usually keep the later one
  cutoff   contains a word broken off mid-way ("de-")
  filler   contains um / uh / erm …
  lowconf  Whisper wasn't sure about some words

Writes phrases.json (for the resolver) and takes.md (for the agent).
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .levels import envelope, levels, phrase_level
from .project import Project, fmt_tc, read_json, write_json

FILLERS = {"um", "uh", "erm", "er", "uhm", "umm", "uhh", "hmm", "mm", "mhm", "ah", "eh"}
SENTENCE_END = re.compile(r"[.!?]$")


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9']", "", word.lower())


def is_filler(word: str) -> bool:
    return norm(word) in FILLERS


def is_cutoff(word: str) -> bool:
    return word.endswith("-") or word.endswith("—")


def split_phrases(words: list[dict], gap: float = 0.75, soft_gap: float = 0.4,
                  max_words: int = 28) -> list[list[int]]:
    """Group word indices into phrases. Break on a pause >= gap, or a sentence
    end followed by a pause >= soft_gap, or when a phrase gets long and hits
    any punctuation."""
    phrases: list[list[int]] = []
    cur: list[int] = []
    for i, w in enumerate(words):
        if cur:
            prev = words[cur[-1]]
            pause = w["start"] - prev["end"]
            brk = pause >= gap
            brk |= SENTENCE_END.search(prev["text"]) is not None and pause >= soft_gap
            brk |= is_cutoff(prev["text"]) and pause >= 0.1
            brk |= len(cur) >= max_words and re.search(r"[,;:.!?]$", prev["text"]) is not None
            if brk:
                phrases.append(cur)
                cur = []
        cur.append(i)
    if cur:
        phrases.append(cur)
    return phrases


def content_words(text_words: list[str]) -> list[str]:
    return [n for n in (norm(w) for w in text_words) if n and n not in FILLERS]


def mark_retakes(phrases: list[dict], window_s: float = 120.0, lookahead: int = 10) -> None:
    """Flag a phrase as a retake when a later phrase (close by) restarts the same
    line: same opening words, or mostly the same words overall."""
    for i, p in enumerate(phrases):
        a = content_words(p["words"])
        if len(a) < 2:
            continue
        for j in range(i + 1, min(len(phrases), i + 1 + lookahead)):
            q = phrases[j]
            if q["source"] != p["source"] or q["start"] - p["end"] > window_s:
                break
            b = content_words(q["words"])
            if len(b) < 2:
                continue
            k = min(3, len(a), len(b))
            same_open = a[:k] == b[:k] and k >= 2
            ratio = SequenceMatcher(None, a, b).ratio()
            if same_open or (ratio >= 0.72 and min(len(a), len(b)) >= 4):
                p["flags"].append("retake")
                p["retake_of"] = q["id"]
                break


def mark_alternates(phrases: list[dict], min_ratio: float = 0.75) -> None:
    """Link every phrase to other attempts at the same line anywhere in the same
    source — e.g. the same script read several times over. `alts` lists them."""
    cw = [content_words(p["words"]) for p in phrases]
    sets = [set(c) for c in cw]
    for i, p in enumerate(phrases):
        p.setdefault("alts", [])
    for i, p in enumerate(phrases):
        if len(cw[i]) < 4:
            continue
        for j in range(i + 1, len(phrases)):
            q = phrases[j]
            if q["source"] != p["source"] or len(cw[j]) < 4:
                continue
            # cheap prefilter before the real comparison
            if len(sets[i] & sets[j]) < 0.5 * min(len(sets[i]), len(sets[j])):
                continue
            sm = SequenceMatcher(None, cw[i], cw[j])
            # a phrase may be one line inside a longer phrase: score on the shorter
            matched = sum(b.size for b in sm.get_matching_blocks())
            if matched / min(len(cw[i]), len(cw[j])) >= min_ratio:
                p["alts"].append(q["id"])
                q["alts"].append(p["id"])


def build_phrases(project: Project) -> list[dict]:
    phrases: list[dict] = []
    n = 0
    for src in project.talking_sources():
        tpath = project.transcript_path(src["id"])
        if not tpath.exists():
            continue
        words = read_json(tpath)["words"]
        env = envelope(project, src)
        _, speech, thresh = levels(env)
        for idxs in split_phrases(words):
            n += 1
            ws = [words[i] for i in idxs]
            texts = [w["text"] for w in ws]
            flags: list[str] = []
            if any(is_cutoff(t) for t in texts):
                flags.append("cutoff")
            if any(is_filler(t) for t in texts):
                flags.append("filler")
            if any(w.get("p", 1.0) < 0.35 for w in ws if not is_filler(w["text"])):
                flags.append("lowconf")
            lvl = phrase_level(env, ws[0]["start"], ws[-1]["end"], thresh)
            if lvl is not None and lvl < speech - 6:
                flags.append("quiet")
            phrases.append({
                "id": f"P{n:03d}",
                "source": src["id"],
                "w0": idxs[0],
                "w1": idxs[-1],
                "start": ws[0]["start"],
                "end": ws[-1]["end"],
                "text": " ".join(texts),
                "words": texts,
                "flags": flags,
                "conf": round(sum(w.get("p", 1.0) for w in ws) / len(ws), 2),
                "level_db": round(lvl - speech, 1) if lvl is not None else None,
            })
    mark_retakes(phrases)
    mark_alternates(phrases)
    return phrases


def render_takes_md(project: Project, phrases: list[dict]) -> str:
    data = project.load()
    lines = [
        "# Takes",
        "",
        "Every phrase the speaker said, in recording order. Address cuts by phrase id.",
        "Flags: `retake→Pnnn` a later attempt of this line follows (usually keep the later one) ·",
        "`cutoff` a word breaks off mid-way · `filler` um/uh inside · `lowconf` uncertain words ·",
        "`quiet` delivered noticeably quieter than usual (energy dropped — prefer a stronger take) ·",
        "`≈Pnnn,…` other attempts at the same line elsewhere in the footage (compare them).",
        "Pause before a phrase is shown when it is 1s or longer.",
        "`delivery.md` measures how it was said (pace, fillers, pauses) and compares attempts at the same line.",
        "",
    ]
    by_src: dict[str, list[dict]] = {}
    for p in phrases:
        by_src.setdefault(p["source"], []).append(p)
    for src in data["sources"]:
        ps = by_src.get(src["id"])
        if not ps:
            continue
        audio = f", audio from {src['audio']['source']}" if src.get("audio") else ""
        lines.append(f"## {src['id']}  ({fmt_tc(src['duration'])} long{audio})")
        lines.append("")
        prev_end = None
        for p in ps:
            if prev_end is not None and p["start"] - prev_end >= 1.0:
                lines.append(f"      … {p['start'] - prev_end:.1f}s pause")
            tags = []
            for f in p["flags"]:
                tags.append(f"retake→{p['retake_of']}" if f == "retake" else f)
            if p.get("alts"):
                tags.append("≈" + ",".join(p["alts"]))
            tag = f"  `{' '.join(tags)}`" if tags else ""
            lines.append(f"{p['id']} [{fmt_tc(p['start'])}–{fmt_tc(p['end'])}] {p['text']}{tag}")
            prev_end = p["end"]
        lines.append("")
    other = [s for s in data["sources"] if s["kind"] not in ("camera", "audio")]
    if other:
        lines.append("## Other footage (not transcribed)")
        lines.append("")
        for s in other:
            dur = f", {fmt_tc(s['duration'])}" if s.get("duration") else ""
            lines.append(f"- `{s['id']}` {s['kind']}{dur}: {s['rel']}")
        lines.append("")
    return "\n".join(lines)


def pack(project: Project) -> list[dict]:
    phrases = build_phrases(project)
    write_json(project.root / "phrases.json", phrases)
    (project.root / "takes.md").write_text(render_takes_md(project, phrases))
    return phrases
