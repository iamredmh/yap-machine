import pytest

from yap.kit import beat_blocks, chapter_problems, resolve_chapters, yt_time
from yap.project import YapError

TL = {"duration": 100.0, "segments": [
    {"range": 0, "beat": "hook", "text": "a", "out_start": 0.0, "out_end": 4.0},
    {"range": 0, "beat": "hook", "text": "b", "out_start": 4.0, "out_end": 9.0},
    {"range": 1, "beat": "picker", "text": "c", "out_start": 9.0, "out_end": 40.0},
    {"range": 2, "beat": "demo", "text": "d", "out_start": 40.0, "out_end": 100.0}]}


def test_youtube_time():
    assert yt_time(0) == "0:00" and yt_time(75.4) == "1:15" and yt_time(3725) == "1:02:05"


def test_chapters_by_range_or_time_first_lands_on_zero():
    ch = resolve_chapters({"chapters": [{"range": 2, "title": "Demo"}, {"range": 1, "title": "Picker"},
                                        {"at": 0, "title": "Hook"}]}, TL)
    assert [c["title"] for c in ch] == ["Hook", "Picker", "Demo"] and ch[0]["at"] == 0.0 and ch[2]["at"] == 40.0
    with pytest.raises(YapError):
        resolve_chapters({"chapters": [{"range": 9, "title": "x"}]}, TL)


def test_chapter_rules():
    ok = [{"at": 0.0, "title": "a"}, {"at": 30.0, "title": "b"}, {"at": 60.0, "title": "c"}]
    assert chapter_problems(ok, 100.0) == []
    assert chapter_problems(ok[:2], 100.0)                       # too few
    short = [{"at": 0.0, "title": "a"}, {"at": 5.0, "title": "b"}, {"at": 60.0, "title": "c"}]
    assert any("10s" in p for p in chapter_problems(short, 100.0))


def test_beat_blocks_join_segments_of_one_range():
    b = beat_blocks(TL)
    assert [x["range"] for x in b] == [0, 1, 2] and b[0]["text"] == "a b" and b[0]["end"] == 9.0
