from yap.delivery import _groups, pacing_over_time, summarise, wpm


def S(id, start, words, fillers=0, end=None, pause=None):
    return {"id": id, "source": "A", "start": start, "end": end or start + words / 3.0, "words": words,
            "fillers": fillers, "wpm": wpm(words, (end or start + words / 3.0) - start), "pause_before": pause,
            "level_db": 0, "conf": 1, "flags": []}


def test_wpm_ignores_too_little_to_measure():
    assert wpm(6, 3.0) == 120
    assert wpm(1, 0.5) is None and wpm(8, 0.1) is None


def test_summary_pace_fillers_and_long_pauses():
    stats = [S("P001", 0, 12), S("P002", 6, 12, fillers=2, pause=1.4), S("P003", 12, 3, pause=0.2), S("P004", 30, 12, pause=9.0)]
    s = summarise(stats)
    assert s["wpm_typical"] == 180 and s["fillers"] == 2 and s["long_pauses"] == 2 and s["longest_pause"] == 9.0


def test_pacing_over_time_groups_by_minute():
    stats = [S("P001", 5, 12), S("P002", 70, 6)]
    rows = pacing_over_time(stats)
    assert [r["at"] for r in rows] == [0, 60] and rows[0]["words"] == 12


def test_attempt_groups_follow_alts_transitively():
    ph = [{"id": "P001", "source": "A", "start": 0, "alts": ["P002"]},
          {"id": "P002", "source": "A", "start": 5, "alts": ["P001", "P003"]},
          {"id": "P003", "source": "A", "start": 9, "alts": ["P002"]},
          {"id": "P004", "source": "A", "start": 20, "alts": []}]
    groups = _groups(ph)
    assert len(groups) == 1 and [p["id"] for p in groups[0]] == ["P001", "P002", "P003"]


def test_short_or_silent_take_still_writes_delivery_report(tmp_path):
    from types import SimpleNamespace
    from yap.delivery import write
    from yap.project import write_json

    transcript = tmp_path / "A.json"
    write_json(transcript, {"words": [{"text": "Hello", "start": 0, "end": 1}]})
    project = SimpleNamespace(root=tmp_path, load=lambda: {"sources": [{"id": "A"}]},
                              transcript_path=lambda _: transcript)
    phrases = [{"id": "P001", "source": "A", "start": 0, "end": 1, "w0": 0, "w1": 0, "flags": []}]
    report = write(project, phrases)
    assert report["sources"]["A"]["wpm_range"] is None
    assert "Not enough speech to measure" in (tmp_path / "delivery.md").read_text()
    assert (tmp_path / "delivery.json").exists()
    assert write(project, [])["phrases"] == []
