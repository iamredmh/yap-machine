"""yap-machine — command line for Yap Machine.

  yap-machine init <project> --footage <folder> [--exclude GLOB …]
  yap-machine prep            ingest + sync + transcribe + pack (safe to re-run)
  yap-machine resolve v1      edl.json → timeline.json + script.md
  yap-machine render v1       timeline → renders/v1.mp4   (--draft for a fast 540p check)
  yap-machine check v1        automated QC → cuts/v1/qc.md (--fast skips the re-listen)
  yap-machine joins v1        re-listen to the render at every join → cuts/v1/joins.md + joins/
  yap-machine cut v1          resolve + render + check in one go
  yap-machine delivery [v1]   pace, fillers, pauses: the recording → delivery.md, or a made cut
  yap-machine kit v1          posting kit: chapters.txt, transcript, thumbnail picks → cuts/v1/kit/
  yap-machine reference f.mp4 measure a reference video, optionally --against v1
  yap-machine focus v1        where the action is on the screen: suggested screen_crop per screen range
  yap-machine skill           print the agent's instructions (the same as skill/SKILL.md)
  yap-machine status          what's in the project

Every command takes -p/--project (default: current folder).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .project import Project, YapError, fmt_tc, missing_tool_error, require_tools


def _project(args) -> Project:
    return Project(Path(args.project))


def cmd_init(args) -> None:
    p = Project(Path(args.dir))
    p.root.mkdir(parents=True, exist_ok=True)
    from .ingest import ingest
    srcs = ingest(p, Path(args.footage).expanduser(), args.exclude)
    _print_sources(srcs)
    print(f"\nproject ready at {p.root}. Next: yap-machine prep -p {p.root}")


def _print_sources(srcs: list[dict]) -> None:
    for s in srcs:
        dur = fmt_tc(s["duration"]) if s.get("duration") else "     "
        res = f"{s.get('width')}x{s.get('height')}@{s.get('fps')}" if s.get("has_video") else ""
        print(f"  {s['kind']:7} {dur}  {s['id']:28} {res}")


def cmd_prep(args) -> None:
    p = _project(args)
    data = p.load()
    if args.rescan:
        from .ingest import ingest
        ingest(p, Path(data["footage"]), args.exclude)
    from .sync import sync
    if any(s["kind"] == "audio" for s in p.sources()):
        print("syncing separate audio …")
        for r in sync(p):
            ch = r["chosen"]
            if ch:
                mark = "✓" if ch["covers"] else "·"
                print(f"  {mark} {r['camera']} ↔ {r['mic']}: mic = camera {ch['offset']:+.3f}s"
                      f" ({ch['drift_ppm']:+.0f} ppm) by {ch['method']}, covers {ch['range'][0]:.1f}–{ch['range'][1]:.1f}s")
            else:
                print(f"  · {r['camera']} ↔ {r['mic']}: no confident match")
            if not r["camera_heard_speech"]:
                print(f"    camera's own audio has no speech; synced from the picture")
            if r.get("warning"):
                print(f"    ! {r['warning']}")
    if any(s["kind"] == "screen" for s in p.sources()):
        from .sync import sync_screens
        print("syncing screen recordings …")
        for r in sync_screens(p):
            ch = r["chosen"]
            print(f"  {'✓' if ch else '·'} {r['screen']}: " +
                  (f"screen = camera {ch['offset']:+.3f}s ({ch['to']}, confidence {ch['confidence']})"
                   if ch else r.get("why", "no confident match")))
    from .transcribe import transcribe
    print("transcribing …")
    done = transcribe(p, model=args.model, force=args.force)
    print(f"  transcribed: {', '.join(done) or 'nothing new'}")
    from .pack import pack
    phrases = pack(p)
    flagged = sum(1 for x in phrases if "retake" in x["flags"])
    print(f"packed {len(phrases)} phrases ({flagged} flagged as retakes) → {p.root / 'takes.md'}")
    from .delivery import write as write_delivery
    write_delivery(p, phrases)
    print(f"measured delivery (pace, fillers, pauses) → {p.root / 'delivery.md'}")


def cmd_resolve(args) -> None:
    from .resolve import resolve
    tl = resolve(_project(args), args.version)
    print(f"{tl['version']}: {len(tl['segments'])} segments, {fmt_tc(tl['duration'])}")


def cmd_render(args) -> None:
    from .render import render
    out = render(_project(args), args.version, draft=args.draft, jobs=args.jobs, lang=args.lang)
    print(f"rendered → {out}")


def cmd_visuals(args) -> None:
    from .render import render
    from .project import read_json
    out = render(_project(args), args.version, draft=args.preview, jobs=args.jobs,
                 visual_export=True, preview_at=args.at if args.preview else None,
                 visual_settings=read_json(Path(args.settings)) if args.settings else None)
    print(f"rendered → {out}")


def cmd_visuals_source(args) -> None:
    import contextlib
    import json
    from .visuals import preview_source
    with contextlib.redirect_stdout(sys.stderr):
        plan = preview_source(_project(args), args.version, args.matte)
    print(json.dumps(plan))


def cmd_visuals_catalog(args) -> None:
    import json
    from .visuals import catalog
    print(json.dumps(catalog()))


def cmd_check(args) -> int:
    from .check import check
    p = _project(args)
    r = check(p, args.version, getattr(args, "lang", None), deep=not getattr(args, "fast", False))
    print(f"{args.version}: {fmt_tc(r['duration'])}, {r['joins']} joins, "
          f"{len(r['errors'])} errors, {len(r['warnings'])} warnings → {p.cut_dir(args.version) / ('qc.' + args.lang + '.md' if getattr(args, 'lang', None) else 'qc.md')}")
    for e in r["errors"]:
        print(f"  ERROR {e}")
    return 1 if r["errors"] else 0


def cmd_joins(args) -> None:
    from .joins import review
    p = _project(args)
    r = review(p, args.version, args.lang, asr=not args.no_asr, sheets=not args.no_sheets, model=args.model)
    print(f"{args.version}: {len(r['joins'])} joins, {r['flagged']} flagged → {p.cut_dir(args.version) / 'joins.md'}")
    for w in r["warnings"]:
        print(f"  {w}")


def cmd_delivery(args) -> None:
    from .delivery import cut_report, write
    from .project import read_json
    p = _project(args)
    if args.version:
        r = cut_report(p, args.version)
        print(f"{args.version}: {r['overall_wpm']} wpm over {r['words']} words → {p.cut_dir(args.version) / 'delivery.md'}")
    else:
        r = write(p, read_json(p.root / "phrases.json"))
        for sid, sm in r["sources"].items():
            print(f"{sid}: typical {sm['wpm_typical']} wpm, {sm['fillers_per_100']} fillers per 100 words, "
                  f"{sm['long_pauses']} long pauses → {p.root / 'delivery.md'}")


def cmd_kit(args) -> None:
    from .kit import build
    p = _project(args)
    r = build(p, args.version, with_thumbs=not args.no_thumbs)
    print(f"{args.version}: {len(r['chapters'])} chapters, {len(r['thumbs'])} thumbnail picks → {r['dir']}")
    for pr in r["problems"]:
        print(f"  ! {pr}")


def cmd_reference(args) -> None:
    from .reference import compare, describe, measure, write_reference
    p = _project(args)
    m = measure(Path(args.video), asr=not args.no_asr, ocr=not args.no_ocr)
    out = write_reference(p, m)
    print(f"measured {m['file']} → {out}")
    print("\n".join(describe(m)))
    if args.against:
        vs = compare(p, m, args.against, asr=not args.no_asr, ocr=not args.no_ocr)
        print(f"\n{args.against} beside it → {vs}")


def cmd_focus(args) -> None:
    from .focus import run
    p = _project(args)
    r = run(p, args.version)
    print(f"{args.version}: {len(r['ranges'])} screen ranges → {p.cut_dir(args.version) / 'focus.md'}")


def cmd_cut(args) -> int:
    cmd_resolve(args)
    cmd_render(args)
    return cmd_check(args)


def cmd_shorts(args) -> None:
    """List the approved long cut's material so the agent can pick shorts from it."""
    from .project import read_json, normalise_version
    p = _project(args)
    v = normalise_version(args.version)
    edl = read_json(p.cut_dir(v) / "edl.json")
    tl_path = p.cut_dir(v) / "timeline.json"
    if not tl_path.exists():
        from .resolve import resolve
        resolve(p, v)
    tl = read_json(tl_path)
    lines = [f"# Material for shorts from {v} ({fmt_tc(tl['duration'])})", "",
             "Each row is one range of the long cut. A short is 30–90s, opens on its strongest line,",
             "and makes one point. Write it as cuts/" + v + "/shorts/sN/edl.json with",
             f'"parent": "{v}", "format": {{"width": 1080, "height": 1920}}; ranges use the same phrase ids.', "",
             "| range | at | length | beat | phrases | opens with |", "|---|---|---|---|---|---|"]
    for i, r in enumerate(edl["ranges"]):
        segs = [s for s in tl["segments"] if s["range"] == i]
        if not segs:
            continue
        dur = sum(s["end"] - s["start"] for s in segs)
        ids = r.get("from", "") + (f"–{r['to']}" if r.get("to") else "")
        lines.append(f"| {i} | {fmt_tc(segs[0]['out_start'])} | {dur:.1f}s | {r.get('beat', '')} | {ids} | "
                     f"{' '.join(segs[0]['text'].split()[:12])}… |")
    out = p.cut_dir(v) / "shorts.md"
    out.write_text("\n".join(lines) + "\n")
    print(f"{len(edl['ranges'])} ranges → {out}")


def skill_text() -> str:
    """The agent skill: bundled in the package, or the repo's skill/SKILL.md when run from a checkout."""
    from importlib.resources import files
    bundled = files("yap").joinpath("SKILL.md")
    if bundled.is_file():
        return bundled.read_text()
    repo = Path(__file__).resolve().parents[2] / "skill" / "SKILL.md"
    if repo.is_file():
        return repo.read_text()
    raise YapError("the agent skill isn't bundled with this install; read skill/SKILL.md in the repository")


def cmd_skill(args) -> None:
    print(skill_text(), end="")


def cmd_doctor(args) -> int:
    from .doctor import run
    return run()


def cmd_status(args) -> None:
    p = _project(args)
    data = p.load()
    print(f"footage: {data['footage']}")
    _print_sources(data["sources"])
    for s in data["sources"]:
        if s.get("audio"):
            print(f"  {s['id']} sound from {s['audio']['source']} (offset {s['audio']['offset']:+.3f}s)")
    print(f"versions: {', '.join(p.versions()) or 'none yet'}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="yap-machine", description="Yap Machine: talking-head footage in, a cut that makes sense out.")
    ap.add_argument("--version", action="version", version=f"yap-machine {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help_):
        sp = sub.add_parser(name, help=help_)
        sp.set_defaults(fn=fn)
        if name != "init":
            sp.add_argument("-p", "--project", default=".", help="project folder (default: .)")
        return sp

    sp = add("init", cmd_init, "create a project from a footage folder")
    sp.add_argument("dir", help="project folder to create (keep it off cloud-synced drives)")
    sp.add_argument("--footage", required=True, help="folder of raw footage (read only)")
    sp.add_argument("--exclude", action="append", default=[], help="glob of files to ignore (repeatable)")

    sp = add("prep", cmd_prep, "sync audio, transcribe and pack phrases")
    sp.add_argument("--model", help="whisper.cpp model path")
    sp.add_argument("--force", action="store_true", help="re-transcribe even if a transcript exists")
    sp.add_argument("--rescan", action="store_true", help="re-scan the footage folder first")
    sp.add_argument("--exclude", action="append", default=[])

    for name, fn, h in [("resolve", cmd_resolve, "turn edl.json into exact cut points"),
                        ("render", cmd_render, "render a version"),
                        ("check", cmd_check, "automated QC on a version"),
                        ("cut", cmd_cut, "resolve + render + check")]:
        sp = add(name, fn, h)
        sp.add_argument("version", help="v1, v2, … or a short like v2.s1")
        if name in ("render", "cut", "check"):
            sp.add_argument("--lang", help="burn translated captions from captions.<lang>.json")
        if name in ("check", "cut"):
            sp.add_argument("--fast", action="store_true", help="skip re-listening to the render at every join")
        if name in ("render", "cut"):
            sp.add_argument("--draft", action="store_true", help="fast 540p render for checking cut points")
            sp.add_argument("--jobs", type=int, default=4)

    sp = add("joins", cmd_joins, "re-listen to a render at every join and draw a sheet per join")
    sp.add_argument("version", help="v1, v2, … or a short like v2.s1")
    sp.add_argument("--lang", help="check the render with translated captions")
    sp.add_argument("--no-asr", action="store_true", help="skip re-transcribing; check room sound only")
    sp.add_argument("--no-sheets", action="store_true", help="skip the pictures")
    sp.add_argument("--model", help="whisper.cpp model path")

    sp = add("delivery", cmd_delivery, "how it was said: pace, fillers, pauses (the recording, or a made cut)")
    sp.add_argument("version", nargs="?", help="a cut to report on; omit for the whole recording")

    sp = add("kit", cmd_kit, "posting kit: chapters, transcript, thumbnail picks")
    sp.add_argument("version", help="a made cut, e.g. v2")
    sp.add_argument("--no-thumbs", action="store_true", help="skip the thumbnail picks")

    sp = add("reference", cmd_reference, "measure a reference video (cuts, pace, captions, framing); optionally beside a cut")
    sp.add_argument("video", help="the reference video file (measured, never copied from)")
    sp.add_argument("--against", metavar="VERSION", help="also measure this cut the same way and compare")
    sp.add_argument("--no-asr", action="store_true", help="skip transcribing the speech")
    sp.add_argument("--no-ocr", action="store_true", help="skip reading on-screen text")

    sp = add("focus", cmd_focus, "suggest where to zoom on the screen recording, range by range")
    sp.add_argument("version", help="a cut with screen ranges, e.g. v2")

    sp = add("shorts", cmd_shorts, "list a long cut's material for picking shorts")
    sp.add_argument("version", help="the approved long cut, e.g. v2")

    sp = add("visuals", cmd_visuals, "export styles and effects without replacing the original cut")
    sp.add_argument("version", help="v1, v2, … or a short like v2.s1")
    sp.add_argument("--preview", action="store_true", help="render a six-second draft preview")
    sp.add_argument("--at", type=float, default=0, help="preview start, in seconds into the cut")
    sp.add_argument("--jobs", type=int, default=4)
    sp.add_argument("--settings", help="render a saved settings snapshot")
    sp = add("visuals-source", cmd_visuals_source, "prepare the cut for the live styles preview")
    sp.add_argument("version")
    sp.add_argument("--matte", action="store_true")
    sub.add_parser("visuals-catalog", help="list the installed styles and effects as JSON").set_defaults(fn=cmd_visuals_catalog)

    add("status", cmd_status, "show the project")
    sub.add_parser("doctor", help="check the local tools Yap Machine uses").set_defaults(fn=cmd_doctor)
    sub.add_parser("skill", help="print the instructions an agent follows to edit with Yap Machine").set_defaults(fn=cmd_skill)

    args = ap.parse_args(argv)
    try:
        if args.fn not in (cmd_doctor, cmd_skill, cmd_status, cmd_visuals_catalog):
            require_tools("ffmpeg", "ffprobe")        # a clear message now, not a traceback halfway through
        rc = args.fn(args)
    except FileNotFoundError as e:                    # any other program the engine shells out to
        print(f"yap: {missing_tool_error(Path(str(e.filename or 'a program')).name)}", file=sys.stderr)
        sys.exit(2)
    except YapError as e:
        print(f"yap: {e}", file=sys.stderr)
        sys.exit(2)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
