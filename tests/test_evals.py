import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "evals"))
import fixture  # noqa: E402
from run import plain, reference_edl  # noqa: E402


def test_every_good_line_is_spoken_and_no_bad_fragment_is_inside_one():
    spoken = [plain(t) for t, _ in fixture.TAKE]
    for g in fixture.GOOD:
        assert any(g in t for t in spoken), g
    # a bad fragment must never share a spoken line with a good one, or keeping the line would be a fair choice
    for b in fixture.BAD:
        holders = [t for t in spoken if b in t]
        assert holders, b
        assert not any(g in t for t in holders for g in fixture.GOOD), b


def test_reference_edl_picks_the_finished_takes_by_what_they_say_not_by_number():
    phrases = [{"id": "P001", "text": "Okay, rolling."}, {"id": "P002", "text": "Today we are going to look at three things."},
               {"id": "P007", "text": "Today we are going to look at three things about cooking pasta."},
               {"id": "P009", "text": "First, salt the water properly, until it tastes like the sea."},
               {"id": "P012", "text": "Second, never rinse the pasta, because the starch helps the sauce stick."},
               {"id": "P013", "text": "Third, save a cup of the cooking water."}, {"id": "P014", "text": "And that's it. Thanks for watching."}]
    edl = reference_edl(phrases)
    assert [r["from"] for r in edl["ranges"]] == ["P007", "P009", "P012", "P013", "P014"]


def test_plain_normalises_punctuation_and_case():
    assert plain("Today, we're  going to—look!") == "today we're going to look"
