import numpy as np

from yap.focus import activity, box_of, crop_for, split_hints


def test_box_holds_the_activity_and_none_when_still():
    m = np.zeros((100, 200), np.int32)
    m[20:40, 150:190] = 3                       # something happening top-right
    x, y, w, h = box_of(m)
    assert 0.7 < x < 0.8 and 0.19 < y < 0.21 and 0.15 < w < 0.25 and 0.15 < h < 0.25
    assert box_of(np.zeros((100, 200), np.int32)) is None


def test_crop_keeps_the_screens_shape_pads_clamps_and_declines_when_it_fills_the_screen():
    crop, zoom = crop_for([0.45, 0.2, 0.05, 0.2])
    assert crop[2] == crop[3] and crop[2] >= 0.4 and zoom <= 2.5
    # near the right edge: the crop slides back inside the screen
    crop, _ = crop_for([0.95, 0.4, 0.05, 0.1])
    assert crop[0] + crop[2] <= 1.0001
    assert crop_for([0.05, 0.05, 0.9, 0.9]) == (None, 1.0)


def test_page_changes_are_not_where_to_look():
    f = np.zeros((4, 40, 40), np.uint8)
    f[1:, :, :] = 200                           # whole frame changes at once
    d, frac = activity(f)
    assert frac[0] > 0.9 and not d.any()
    g = np.zeros((3, 40, 40), np.uint8)
    g[1, 5:10, 5:10] = 200                      # a small local change
    d, _ = activity(g)
    assert d[0].sum() == 25


def test_split_hints_when_the_action_moves():
    w = [{"t": 0, "box": [0.1, 0.1, 0.1, 0.1]}, {"t": 2, "box": [0.12, 0.1, 0.1, 0.1]}, {"t": 4, "box": [0.7, 0.6, 0.1, 0.1]},
         {"t": 6, "box": None}, {"t": 8, "box": [0.7, 0.62, 0.1, 0.1]}]
    assert split_hints(w) == [4]
