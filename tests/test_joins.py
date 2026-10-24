import numpy as np

from yap.joins import edge_report, extra_at_cut, repeated_across, tone_across


def test_boundary_word_missing_or_clipped():
    ok = edge_report(["so", "give", "me", "an", "outline"], ["give", "me", "an", "outline"], at_end=True)
    assert ok["state"] == "ok"
    gone = edge_report(["not", "too", "fast"], ["not", "too", "much", "cost"], at_end=True)
    assert gone["state"] == "missing" and gone["boundary"] == "fast"
    clipped = edge_report(["wouldnt", "it", "be", "great"], ["gre"], at_end=True)
    assert clipped["state"] == "clipped"
    head = edge_report(["deepseek", "is", "fast"], ["see", "is", "fast"], at_end=False)
    assert head["state"] == "clipped" and head["boundary"] == "deepseek"
    # a dropped plural is not a clipped word
    assert edge_report(["my", "apps"], ["my", "app"], at_end=True)["state"] == "ok"


def test_short_words_dropped_by_whisper_are_not_flagged():
    r = edge_report(["this", "is", "a"], ["this", "is"], at_end=True)
    assert r["state"] == "ok"


def test_fuzzy_spelling_counts_as_the_same_word():
    assert edge_report(["sonnet", "five"], ["sonnett", "five"], at_end=True)["state"] == "ok"


def test_repeat_across_a_join():
    assert repeated_across(["my", "app"], ["app", "market"], ["my", "app"], ["market"]) == "app"
    assert repeated_across(["that", "that"], ["that", "is"], ["that", "that"], ["that", "is"]) is None


def _env(db_before, db_after, n=100):
    rng = np.random.default_rng(1)
    return np.concatenate([db_before + rng.normal(0, .5, n), db_after + rng.normal(0, .5, n)])


def test_tone_flags_background_change_and_vanishing_silence():
    # envelope frames are 10 ms: the join sits at 1.0 s. Add loud speech so the threshold is sane.
    speech = np.full(300, -15.0)
    def build(before, after):
        return np.concatenate([speech, np.full(60, before), np.full(60, after), speech])
    env = build(-50.0, -50.0)
    assert tone_across(env, 3.6)["problems"] == []
    shifted = build(-50.0, -35.0)
    assert any("room sound changes" in p for p in tone_across(shifted, 3.6)["problems"])
    vanished = build(-50.0, -95.0)
    assert any("room sound changes" in p or "digital silence" in p for p in tone_across(vanished, 3.6)["problems"])


def test_tone_needs_a_pause_each_side_to_compare():
    env = np.concatenate([np.full(100, -50.0), np.full(300, -15.0), np.full(20, -50.0), np.full(300, -15.0)])
    t = tone_across(env, 4.25)
    assert t["floor_after"] is None and t["problems"] == []


def Wd(text, start, end):
    return {"text": text, "start": start, "end": end}


def test_a_word_heard_at_the_cut_that_the_script_lacks_is_a_stray():
    # "Hi, I'm Dan | Today we are going": the cut at 1.0 s still has the front of "and" in it
    meant = [Wd("Hi,", 0.1, 0.3), Wd("I'm", 0.5, 0.7), Wd("Dan", 0.8, 1.0), Wd("Today", 1.3, 1.6), Wd("we", 1.7, 1.8), Wd("are", 1.9, 2.0)]
    heard = [Wd("I'm", 0.5, 0.7), Wd("Dan", 0.8, 1.0), Wd("and", 1.05, 1.2), Wd("today", 1.3, 1.6), Wd("we", 1.7, 1.8), Wd("are", 1.9, 2.0)]
    # Whisper dropped the leading "Hi": that is not evidence the stray was misheard
    assert extra_at_cut(heard, meant, 1.0) == ["and"]


def test_a_misheard_word_is_not_a_stray():
    meant = [Wd("not", 0.2, 0.4), Wd("too", 0.5, 0.7), Wd("fast.", 0.8, 1.0), Wd("But", 1.2, 1.4), Wd("now", 1.5, 1.7)]
    heard = [Wd("not", 0.2, 0.4), Wd("too", 0.5, 0.7), Wd("much", 0.8, 0.9), Wd("cost", 0.95, 1.1), Wd("but", 1.2, 1.4), Wd("now", 1.5, 1.7)]
    assert extra_at_cut(heard, meant, 1.1) == []


def test_clean_cut_and_words_far_from_the_cut_are_ignored():
    meant = [Wd("so", 0.1, 0.3), Wd("therefore", 0.4, 0.8), Wd("different", 0.9, 1.3), Wd("suited", 2.0, 2.3)]
    heard = [Wd("so", 0.1, 0.3), Wd("therefore", 0.4, 0.8), Wd("different", 0.9, 1.3), Wd("suited", 2.0, 2.3)]
    assert extra_at_cut(heard, meant, 1.5) == []
    # an extra word a second from the cut is Whisper's business, not the join's
    heard.insert(1, Wd("really", 0.35, 0.4))
    assert extra_at_cut(heard, meant, 1.5) == []
