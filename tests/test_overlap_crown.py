"""Native crown geometry is bounded, face-local and optional for other looks."""
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from yap.project import Project, write_json
from yap.visuals import _mask_crown, face_measurements, preview_source, validate, visual_plan


SHOOT = {'faceX': 200., 'crown': 154., 'eyes': 240., 'chin': 316.}


def mask_image(top=170):
    image = np.zeros((600, 400), np.uint8)
    cv2.ellipse(image, (200, top + 60), (55, 60), 0, 0, 360, 255, -1)
    cv2.rectangle(image, (110, top + 105), (290, 599), 255, -1)
    return image


@pytest.fixture
def masks(tmp_path):
    path = tmp_path / 'masks'
    path.mkdir()
    for i in range(8, 13):
        cv2.imwrite(str(path / f'{i:06d}.png'), mask_image())
    return {'dir': str(path), 'fps': 24, 'count': 2400}


def test_uses_only_five_early_masks_and_ignores_hands_other_people_and_noise(masks, monkeypatch):
    baseline = _mask_crown(masks, SHOOT, 400, 600)
    assert baseline == pytest.approx(172, abs=2)
    for i in range(8, 13):
        image = mask_image()
        cv2.rectangle(image, (40, 30), (100, 380), 255, -1)  # raised arm joined at torso
        cv2.rectangle(image, (90, 350), (120, 400), 255, -1)
        cv2.ellipse(image, (350, 130), (40, 90), 0, 0, 360, 255, -1)  # second person
        cv2.rectangle(image, (190, 60), (215, 120), 255, -1)  # hand above face, with a gap
        image[145, 205] = 255  # disconnected noise
        cv2.rectangle(image, (190, 70), (193, 195), 255, -1)  # narrow foreground finger
        cv2.imwrite(str(Path(masks['dir']) / f'{i:06d}.png'), image)
    reads = []
    original = cv2.imread
    monkeypatch.setattr(cv2, 'imread', lambda path, mode: reads.append(Path(path).name) or original(path, mode))
    assert _mask_crown(masks, SHOOT, 400, 600) == pytest.approx(baseline, abs=2)
    assert reads == [f'{i:06d}.png' for i in range(8, 13)]
    assert SHOOT == {'faceX': 200., 'crown': 154., 'eyes': 240., 'chin': 316.}


def test_ambiguous_occlusion_motion_and_missing_masks_preserve_original_geometry(masks):
    for i in range(8, 13):
        image = mask_image()
        image[70:260, 165:235] = 255  # broad connected occlusion obscures the head
        cv2.imwrite(str(Path(masks['dir']) / f'{i:06d}.png'), image)
    assert _mask_crown(masks, SHOOT, 400, 600) is None
    for i in range(8, 13):
        cv2.imwrite(str(Path(masks['dir']) / f'{i:06d}.png'), mask_image(170 if i < 10 else 200))
    assert _mask_crown(masks, SHOOT, 400, 600) is None
    assert _mask_crown({**masks, 'dir': '/missing-test-masks'}, SHOOT, 400, 600) is None
    assert _mask_crown(masks, {}, 400, 600) is None


def test_no_detected_face_does_not_promote_an_unrelated_person_mask(masks, monkeypatch):
    import yap.visuals as visuals
    capture = SimpleNamespace(set=lambda *a: None, read=lambda: (True, np.zeros((600, 400, 3), np.uint8)), release=lambda: None)
    monkeypatch.setattr(cv2, 'VideoCapture', lambda *a: capture)
    monkeypatch.setattr('yap.reframe._detector', lambda: SimpleNamespace(detectMultiScale=lambda *a, **kw: []))
    monkeypatch.setattr(visuals, '_mask_crown', lambda *a: pytest.fail('Fallback face geometry is not evidence of a detected head'))
    assert 'maskCrown' not in face_measurements(Path('fixture.mp4'), 400, 600, masks)


def test_preview_and_export_share_native_metadata_without_changing_legacy_geometry(tmp_path, masks, monkeypatch):
    import yap.visuals as visuals
    project = Project(tmp_path / 'project')
    project.root.mkdir()
    plate = project.root / 'source.mp4'
    plate.write_bytes(b'local video fixture')
    project.save({'sources': [{'id': 'camera', 'path': str(plate)}]})
    timeline = {'version': 'v1', 'width': 400, 'height': 600, 'fps': 24, 'duration': 2,
                'segments': [{'source': 'camera', 'start': 0, 'end': 2, 'out_start': 0, 'out_end': 2}]}
    write_json(project.cut_dir('v1') / 'timeline.json', timeline)
    monkeypatch.setattr('yap.overlays.output_words', lambda *a: [])
    monkeypatch.setattr(visuals, 'prepare_matte', lambda *a: masks)
    def measured(_plate, width, height, mask=None):
        return {**SHOOT, **({'maskCrown': _mask_crown(mask, SHOOT, width, height)} if mask else {})}
    monkeypatch.setattr(visuals, 'face_measurements', measured)
    def cut(_project, _timeline, work, _draft):
        path = work / 'plate.mkv'
        path.write_bytes(b'undecorated plate')
        return path
    monkeypatch.setattr('yap.render.cut_plate', cut)
    def run(cmd, **kwargs):
        Path(cmd[-1]).write_bytes(b'preview source')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(visuals, 'run', run)
    source = preview_source(project, 'v1', matte=True)
    config = validate(project, timeline, {'preset': 'nat-clean', 'brandNat': {'layout': 'L5', 'subjectOverlap': True}})
    exported = visual_plan(project, 'v1', plate, project.root / 'work', timeline, config, {}, False)
    assert source['shoot']['maskCrown'] == exported['shoot']['maskCrown'] == pytest.approx(172, abs=2)
    for key in ['crown', 'eyes', 'chin']:
        assert source['shoot'][key] == exported['shoot'][key] == SHOOT[key]
    for recipe in [{'layout': 'L5', 'subjectOverlap': False}, {'layout': 'L4', 'subjectOverlap': True}, {'hook': 'H1'}]:
        config = validate(project, timeline, {'preset': 'nat-clean', 'brandNat': recipe})
        legacy = visual_plan(project, 'v1', plate, project.root / 'work', timeline, config, {}, False)
        assert 'maskCrown' not in legacy['shoot']
        assert legacy['shoot']['crown'] == SHOOT['crown']
