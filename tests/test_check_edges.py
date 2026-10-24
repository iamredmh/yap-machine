import numpy as np

from yap.check import speech_past_cut

HOP = 0.01


def env_with(loud_spans, n=800, quiet=-70.0, loud=-25.0):
    e = np.full(n, quiet)
    for a, b in loud_spans:
        e[int(a / HOP):int(b / HOP)] = loud
    return e


def W(text, a, b):
    return {"text": text, "start": a, "end": b}


def test_speech_running_back_from_a_start_with_no_words_is_flagged():
    # speech 2.5-3.5; the transcript only has the last word, "suited", from 3.0; the cut starts at 3.0
    env = env_with([(2.5, 3.8)])
    run, stops, covered = speech_past_cut(env, [W("suited", 3.0, 3.8)], 3.0, "start", -50)
    assert abs(run - 0.5) < 0.03 and abs(stops - 2.5) < 0.03 and covered < 0.1


def test_a_clean_cut_in_silence_has_no_run():
    env = env_with([(1.0, 2.0), (3.0, 4.0)])
    assert speech_past_cut(env, [W("a", 1.0, 2.0)], 2.5, "start", -50)[0] == 0.0
    assert speech_past_cut(env, [W("a", 1.0, 2.0)], 2.5, "end", -50)[0] == 0.0


def test_speech_explained_by_words_is_covered():
    # a start in continuous speech, but the transcript has the words before it
    env = env_with([(1.0, 3.0)])
    run, _, covered = speech_past_cut(env, [W("so", 1.0, 1.6), W("now", 1.6, 3.0)], 1.6, "start", -50)
    assert run > 0.5 and covered > 0.9


def test_speech_continuing_past_an_end_is_found_in_the_other_direction():
    env = env_with([(1.0, 2.4)])
    run, stops, covered = speech_past_cut(env, [W("model", 1.0, 2.0)], 2.0, "end", -50)
    assert abs(run - 0.4) < 0.03 and abs(stops - 2.4) < 0.03 and covered < 0.1


def test_a_short_dip_does_not_end_the_run_but_a_pause_does():
    env = env_with([(1.0, 1.4), (1.42, 2.0)])      # a 20 ms dip inside a word
    assert speech_past_cut(env, [], 2.0, "start", -50)[0] > 0.9
    env = env_with([(1.0, 1.4), (1.6, 2.0)])       # a 200 ms pause
    assert abs(speech_past_cut(env, [], 2.0, "start", -50)[0] - 0.4) < 0.03
