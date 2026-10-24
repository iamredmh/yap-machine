import numpy as np

from yap.edges import describe, real_words, settle_edge, voiced_share

HOP = 0.01
SR = 16000
RNG = np.random.default_rng(7)


def env_with(spans, n=1200, quiet=-70.0, loud=-25.0):
    e = np.full(n, quiet)
    for a, b in spans:
        e[int(a / HOP):int(b / HOP)] = loud
    return e


def W(text, a, b, p=0.9):
    return {"text": text, "start": a, "end": b, "p": p}


def tone(a, b, f0=150.0):
    t = np.arange(int((b - a) * SR)) / SR
    return (0.3 * sum(np.sin(2 * np.pi * f0 * k * t) / k for k in (1, 2, 3, 4))).astype(np.float32)


def noise(a, b):
    return (0.2 * RNG.standard_normal(int((b - a) * SR))).astype(np.float32)


def reader(kind):
    return lambda a, b: (tone if kind == "speech" else noise)(a, b)


def test_voiced_share_tells_speech_from_noise():
    assert voiced_share(tone(0, 0.5)) > 0.9
    assert voiced_share(noise(0, 0.5)) < 0.2
    assert voiced_share(np.zeros(100, np.float32)) == 0.0


# speech 2.5-5.5; the transcript knows "suited for" from 3.0 and nothing before it
ENV = env_with([(2.5, 5.5)])
KNOWN = [W("suited", 3.0, 3.6), W("for", 3.6, 3.9)]
PREV = W("are", 1.2, 1.9)


def test_a_long_voiced_run_across_a_start_moves_the_edge_to_the_quiet_before_it():
    fx = settle_edge(ENV, KNOWN, 2.95, "start", 1.0, 3.0, reader("speech"), outside=PREV)
    assert fx and abs(fx["t"] - 2.47) < 0.02 and fx["run"] > 0.4 and fx["voiced"] > 0.5


def test_a_long_run_of_noise_is_left_out():
    env = env_with([(2.0, 5.5)])        # 0.95 s of unpitched sound running into the start
    assert settle_edge(env, KNOWN, 2.95, "start", 1.0, 3.0, reader("noise"), outside=PREV) is None


def test_a_run_under_half_a_second_is_a_words_own_onset_whatever_it_sounds_like():
    # "First": the f is hiss with no pitch, and the transcript puts the word 0.3 s late
    env = env_with([(2.65, 5.5)])
    fx = settle_edge(env, KNOWN, 2.95, "start", 1.0, 3.0, reader("noise"), outside=PREV)
    assert fx and abs(fx["t"] - 2.62) < 0.02 and fx["voiced"] < 0.2


def test_the_previous_words_tail_is_never_taken_in():
    # the previous word ends at 2.7; sound runs 2.5-3.0 into the start. That is its tail.
    assert settle_edge(ENV, KNOWN, 2.95, "start", 1.0, 3.0, reader("speech"), outside=W("right", 2.0, 2.7)) is None


def test_an_end_that_clips_a_word_moves_to_the_quiet_after_it():
    env = env_with([(1.0, 2.4)])
    fx = settle_edge(env, [W("model", 1.0, 2.0)], 2.0, "end", 0.0, 3.0, reader("speech"), outside=W("and", 3.0, 3.2))
    assert fx and abs(fx["t"] - 2.43) < 0.02


def test_the_next_words_head_is_never_taken_in_at_an_end():
    env = env_with([(1.0, 2.4)])
    assert settle_edge(env, [W("model", 1.0, 2.0)], 2.0, "end", 0.0, 3.0, reader("speech"), outside=W("and", 2.2, 2.4)) is None


def test_speech_the_transcript_already_explains_is_left_alone():
    words = [W("so", 2.5, 2.9), W("suited", 3.0, 3.6)]
    assert settle_edge(ENV, words, 2.95, "start", 1.0, 3.0, reader("speech"), outside=PREV) is None


def test_an_edge_never_crosses_the_neighbouring_word_or_moves_more_than_a_second():
    fx = settle_edge(ENV, KNOWN, 2.95, "start", 2.8, 3.0, reader("speech"), outside=W("x", 1.0, 1.2))
    assert fx and fx["t"] >= 2.8
    assert settle_edge(env_with([(1.0, 5.5)]), KNOWN, 2.95, "start", 0.0, 3.0, reader("speech")) is None


def test_whisper_names_the_recovered_words_but_the_move_does_not_depend_on_it():
    heard = [W("The", 2.5, 2.7), W("different", 2.7, 2.95)]
    fx = settle_edge(ENV, KNOWN, 2.95, "start", 1.0, 3.0, reader("speech"), lambda a, b: heard, outside=PREV)
    assert [w["text"] for w in fx["words"]] == ["The", "different"]
    assert "The different" in describe("start", fx, "range 4")

    def boom(a, b):
        raise RuntimeError("no model")
    fx = settle_edge(ENV, KNOWN, 2.95, "start", 1.0, 3.0, reader("speech"), boom, outside=PREV)
    assert fx and fx["words"] == [] and "sound" in describe("start", fx, "range 4")


def test_real_words_filters_by_overlap_confidence_and_length_and_skips_the_neighbour():
    ws = [W("a", 1.0, 1.1), W("hello", 1.2, 1.4), W("maybe", 1.5, 1.7, p=0.1), W("late", 5.0, 5.2)]
    assert [w["text"] for w in real_words(ws, 0.9, 2.0)] == ["hello"]
    assert real_words([W("right", 2.3, 2.9)], 2.3, 3.0, outside=W("right", 2.0, 2.6)) == []
    assert real_words([W("you", 2.3, 2.5)], 2.3, 3.0) == []

