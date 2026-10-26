import numpy as np
import pytest

from yap.project import Project
from yap.sync import sync, verify


@pytest.fixture
def project(tmp_path):
    p = Project(tmp_path)
    p.save({"sources": [
        {"id": "camera", "kind": "camera", "path": "/fixture/camera.mp4", "duration": 6, "fps": 24},
        {"id": "mic", "kind": "audio", "path": "/fixture/mic.wav", "duration": 6.3},
    ]})
    return p


def readings(monkeypatch, *, heard=True, audio=(.3, 400), picture=2.93):
    monkeypatch.setattr("yap.sync.motion_cells", lambda *a, **k: np.ones((143, 72)))
    monkeypatch.setattr("yap.sync.speech_envelope", lambda *a, **k: np.ones(151))
    monkeypatch.setattr("yap.sync.camera_heard_speech", lambda *a: heard)
    monkeypatch.setattr("yap.sync.audio_offset", lambda *a: audio)
    monkeypatch.setattr("yap.sync.picture_sync", lambda *a: {"offset": picture, "drift_ppm": 120,
                                                          "r": .7, "cell": [2, 4]})


def test_clear_waveform_match_wins_over_incorrect_picture_motion(project, monkeypatch):
    readings(monkeypatch)
    result = sync(project)[0]
    assert result["chosen"]["offset"] == .3
    assert result["chosen"]["method"] == "audio"
    assert result["chosen"]["drift_ppm"] == 0
    assert "using the recorded audio match" in result["warning"]
    assert project.source("camera")["audio"]["range"] == [0, 6]


@pytest.mark.parametrize("heard,audio", [(False, (.3, 400)), (True, (.3, 2))])
def test_picture_remains_available_for_silent_or_weak_camera_audio(project, monkeypatch, heard, audio):
    readings(monkeypatch, heard=heard, audio=audio)
    result = sync(project)[0]
    assert result["chosen"]["method"] == "picture"
    assert result["chosen"]["offset"] == 2.93


def test_agreeing_picture_and_audio_preserve_the_drift_estimate(project, monkeypatch):
    readings(monkeypatch, picture=.31)
    result = sync(project)[0]
    assert result["chosen"]["method"] == "audio+picture"
    assert result["chosen"]["offset"] == .3
    assert result["chosen"]["drift_ppm"] == 120


def test_short_recording_reports_insufficient_confidence_instead_of_false_failure(project, monkeypatch):
    readings(monkeypatch)
    cam = project.source("camera")
    cam["audio"] = {"source": "mic", "offset": .3}
    result = verify(project, cam, [1])[0]
    assert result["inconclusive"] is True
    assert "too short" in result["reason"]


def test_invalid_stored_offset_cannot_crash_or_pass_as_inconclusive(project, monkeypatch):
    readings(monkeypatch)
    cam = project.source("camera")
    cam["audio"] = {"source": "mic", "offset": 3}
    result = verify(project, cam, [1])[0]
    assert result["z"] == 0
    assert not result.get("inconclusive")
    assert "no comparable audio" in result["reason"]
