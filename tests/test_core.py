from yap.pack import is_cutoff, is_filler, mark_alternates, mark_retakes, split_phrases
from yap.resolve import pause_limit, range_to_runs
from yap.transcribe import dtw_preset, tokens_to_words, refine_ends
from pathlib import Path
import numpy as np


def W(text, start, end, p=1.0):
    return {"text": text, "start": start, "end": end, "p": p}


def tok(text, t0, t1, dtw=-1):
    return {"text": text, "offsets": {"from": int(t0 * 1000), "to": int(t1 * 1000)}, "p": 0.9, "t_dtw": dtw}


def test_tokens_merge_into_words_and_prefer_dtw():
    seg = {"tokens": [tok("[_BEG_]", 0, 0), tok(" It", 0.0, 0.2, 30), tok(" deploy", 0.2, 0.6, 50),
                      tok("s", 0.6, 0.7, 80), tok(".", 0.7, 0.7, 90), tok(" Okay", 1.0, 1.3, 120)]}
    words = tokens_to_words([seg])
    assert [w["text"] for w in words] == ["It", "deploys.", "Okay"]
    assert words[0]["start"] == 0.3 and words[1]["start"] == 0.5 and words[2]["start"] == 1.2


def test_refine_ends_stops_at_first_gap_and_moves_unvoiced_words():
    hop = 0.01
    env = np.full(300, -90.0)
    env[10:60] = -30   # "hello" 0.10-0.60
    env[62:70] = -30   # trailing sound within the gap tolerance
    env[150:200] = -30  # "world" 1.50-2.00
    words = [W("hello", 0.10, 0.2), W("there.", 0.9, 1.0), W("world", 1.5, 1.6)]
    refine_ends(words, env, hop, -60)
    assert abs(words[0]["end"] - 0.72) < 0.02
    # "there." sat in silence: it belongs to the speech before it
    assert words[1]["end"] == words[0]["end"] and words[1].get("moved")
    assert abs(words[2]["end"] - 2.02) < 0.02


def test_split_phrases_on_pause_and_sentence_end():
    words = [W("Hello", 0, .3), W("there.", .35, .6), W("Next", 1.2, 1.4), W("bit,", 1.45, 1.7), W("on", 1.8, 1.9)]
    assert split_phrases(words) == [[0, 1], [2, 3, 4]]


def test_fillers_and_cutoffs():
    assert is_filler("Um,") and is_filler("uh") and not is_filler("umbrella")
    assert is_cutoff("de-") and not is_cutoff("well.")


def _phrase(pid, text, start):
    return {"id": pid, "source": "A", "start": start, "end": start + 2, "words": text.split(), "flags": []}


def test_retakes_and_alternates():
    ps = [_phrase("P001", "Second, we've got a new front of shop.", 0),
          _phrase("P002", "Acme de-", 3),
          _phrase("P003", "Second, we've got a new front of shop. Acme.com has a new page.", 6),
          _phrase("P004", "Totally different words entirely here today.", 60),
          _phrase("P005", "Second, we've got a new front of shop.", 200)]
    mark_retakes(ps)
    mark_alternates(ps)
    assert "retake" in ps[0]["flags"] and ps[0]["retake_of"] == "P003"
    assert "P005" in ps[0]["alts"] and "P003" in ps[4]["alts"]
    assert not ps[3]["alts"]


def test_pause_limit_depends_on_punctuation():
    assert pause_limit("done.", 0.5) == 0.5
    assert pause_limit("first,", 0.5) == 0.8
    assert pause_limit("the", 0.5) == 1.0


def test_range_to_runs_trims_snippets_skips_and_fillers():
    words = [W("Hello", 0, .3), W("um", .4, .5), W("world.", .6, .9), W("Bad", 1.0, 1.2),
             W("take.", 1.25, 1.4), W("Good", 1.5, 1.7), W("one.", 1.75, 2.0)]
    phrases = {"P1": {"id": "P1", "source": "A", "w0": 0, "w1": 2, "words": []},
               "P2": {"id": "P2", "source": "A", "w0": 3, "w1": 4, "words": []},
               "P3": {"id": "P3", "source": "A", "w0": 5, "w1": 6, "words": []}}
    order = ["P1", "P2", "P3"]
    runs = range_to_runs({"from": "P1", "to": "P3", "skip": ["P2"]}, phrases, order, words, 0.5, True)
    assert runs == [(0, 0), (2, 2), (5, 6)]
    runs = range_to_runs({"from": "P1", "start_at": "world."}, phrases, order, words, 0.5, True)
    assert runs == [(2, 2)]


def test_dtw_preset_names():
    assert dtw_preset(Path("ggml-medium.en.bin")) == "medium.en"
    assert dtw_preset(Path("ggml-large-v3-turbo.bin")) == "large.v3.turbo"
    assert dtw_preset(Path("ggml-large-v3-q5_0.bin")) == "large.v3"
    assert dtw_preset(Path("custom.bin")) is None


def test_short_versions_live_under_their_parent(tmp_path):
    from yap.project import Project, normalise_version
    p = Project(tmp_path)
    assert normalise_version("v2.S1") == "v2.s1"
    assert p.cut_dir("v2.s1") == tmp_path.resolve() / "cuts" / "v2" / "shorts" / "s1"
    assert p.render_path("v2.s1").name == "v2.s1.mp4"


def test_vertical_crop_centres_face_and_keeps_headroom():
    from yap.reframe import crop_for
    src = {"width": 3840, "height": 2160}
    # face right of centre, fairly high and large (close webcam)
    samples = [(0.0, 0.6, 0.45, 0.4)] * 5
    x, y, w, h = crop_for(samples, src, 1080, 1920, 1.12)
    assert abs(w - (1 / 1.12) * (9 / 16) / (16 / 9)) < 1e-3
    assert abs((x + w / 2) - 0.6) < 1e-3            # face centred across
    head_top = 0.45 - 0.2 - 0.6 * 0.4
    assert y <= head_top                              # room above the hair
    assert 0 <= y <= 1 - h


def test_caption_grouping_breaks_on_sentences_and_length():
    from yap.overlays import group_captions
    ws = [{"text": t, "start": i * 0.3, "end": i * 0.3 + 0.25} for i, t in
          enumerate("Well now you can. The team added new models today".split())]
    groups = [" ".join(w["text"] for w in g) for g in group_captions(ws, 3, 16)]
    assert groups[0] == "Well now you"
    assert "can." in groups[1] and not groups[1].endswith("The")
    assert all(len(g) <= 22 for g in groups)


def test_translation_split_keeps_sentence_timing():
    from yap.overlays import split_translation
    out = split_translation([{"start": 10.0, "end": 14.0, "text": "Pues ahora puedes elegir tu modelo favorito"}], 3, 16)
    assert out[0]["start"] == 10.0 and abs(out[-1]["end"] - 14.0) < 1e-6
    assert all(len(c["text"]) <= 16 or len(c["text"].split()) == 1 for c in out)


def test_respell_keeps_punctuation():
    from yap.overlays import respell
    sp = {"acme": "Acme", "acme.com": "Acme.com"}
    assert respell("acme?", sp) == "Acme?"
    assert respell("acme.com", sp) == "Acme.com"
    assert respell("coffee,", sp) == "coffee,"


def test_ass_colour_is_bgr_with_alpha():
    from yap.overlays import ass_color
    assert ass_color("#F0412B") == "&H002B41F0"
    assert ass_color("#000000", 1.0) == "&HFF000000"


def test_the_agent_skill_is_readable_from_the_cli():
    from yap.cli import skill_text
    t = skill_text()
    assert t.startswith("---") and "you are the editor" in t and "yap-machine cut" in t


def test_a_missing_ffmpeg_gives_the_install_line_not_a_traceback(monkeypatch, capsys, tmp_path):
    import shutil
    import pytest
    from yap import cli
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: None)
    with pytest.raises(SystemExit) as e:
        cli.main(["init", str(tmp_path / "p"), "--footage", str(tmp_path)])
    assert e.value.code == 2
    err = capsys.readouterr().err
    assert "ffmpeg" in err and "brew install ffmpeg" in err and "yap-machine doctor" in err and "Traceback" not in err


def test_doctor_and_skill_still_work_without_ffmpeg(monkeypatch, capsys):
    import shutil
    import pytest
    from yap import cli
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: None)
    with pytest.raises(SystemExit) as e:
        cli.main(["skill"])
    assert e.value.code == 0 and "you are the editor" in capsys.readouterr().out


def test_run_turns_a_missing_program_into_a_yap_error(monkeypatch):
    import pytest
    from yap.project import YapError, run
    with pytest.raises(YapError) as e:
        run(["definitely-not-installed-tool", "--x"])
    assert "definitely-not-installed-tool" in str(e.value) and "yap-machine doctor" in str(e.value)
