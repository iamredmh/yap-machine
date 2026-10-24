from yap.reference import lettering_colours, shot_stats, suggest, text_lines

WHITE, BLUE = (253, 253, 253), (41, 104, 244)


def test_shot_stats():
    s = shot_stats([2.0, 4.0, 10.0], 20.0)
    assert s["cuts"] == 3 and s["cuts_per_min"] == 9.0 and s["shot_median"] == 4.0 and s["first_cut"] == 2.0
    assert shot_stats([], 30.0)["shot_median"] == 30.0


def test_caption_colour_and_highlight_by_saturation_not_count():
    # two-word captions: white and blue are about equally common; white is still the lettering
    got = lettering_colours([WHITE] * 20 + [BLUE] * 18)
    assert got["colour"] == "#FDFDFD" and got["highlight"] == "#2968F4"
    # no highlight: one colour only
    assert lettering_colours([WHITE] * 20) == {"colour": "#FDFDFD", "highlight": None}
    assert lettering_colours([]) == {"colour": None, "highlight": None}


def test_text_lines_group_by_height():
    boxes = [{"x": 10, "y": 100, "w": 40, "h": 20, "text": "hello"}, {"x": 60, "y": 102, "w": 50, "h": 20, "text": "there"},
             {"x": 10, "y": 300, "w": 40, "h": 20, "text": "next"}]
    lines = text_lines(boxes)
    assert [len(l) for l in lines] == [2, 1] and [b["text"] for b in lines[0]] == ["hello", "there"]


def test_suggest_maps_measurements_to_settings():
    ref = {"aspect": "vertical", "width": 1080, "height": 1920, "speech": {"gap_median": 0.46},
           "frames": {"text": {"frames_with_text": 0.9, "words_at_a_time": 2, "centre_y": 0.8, "height": 0.027,
                               "colour": "#FDFDFD", "highlight": "#2968F4"}}}
    s = suggest(ref)
    assert s["edl"]["max_pause"] == 0.56
    cap = s["style"]["captions"]["short"]
    assert cap["max_words"] == 2 and cap["y"] == 0.8 and cap["highlight"] is True and cap["active"] == "#2968F4"
    # no readable captions, no caption suggestion
    assert "style" not in suggest({"aspect": "wide", "width": 1920, "height": 1080, "speech": None, "frames": {"text": None}})
