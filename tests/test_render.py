import array
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from yap.project import Project, write_json
from yap.render import _measure_loudness, _segment_cmd, render, render_dimensions


@pytest.mark.parametrize('width,height,expected', [
    (1080, 1080, (960, 960)), (1080, 1350, (768, 960)),
    (1440, 1080, (960, 720)), (1080, 1920, (540, 960)),
    (1920, 1080, (960, 540)), (432, 768, (432, 768)),
])
def test_draft_plate_preserves_output_shape_and_even_dimensions(tmp_path, width, height, expected):
    timeline = {'width': width, 'height': height, 'fps': 24}
    assert render_dimensions(timeline, True) == expected
    assert render_dimensions(timeline, False) == (width, height)
    project = Project(tmp_path)
    project.save({'sources': [{'id': 'camera', 'path': 'camera.mp4', 'duration': 2, 'fps': 24}]})
    cmd = _segment_cmd(project, {'source': 'camera', 'start': 0, 'end': 2}, timeline, tmp_path / 'plate.mkv', True)
    w, h = expected
    assert f'scale={w}:{h}:' in cmd[cmd.index('-vf') + 1]
    assert f'pad={w}:{h}:' in cmd[cmd.index('-vf') + 1]


@pytest.mark.parametrize('bad', [
    {'input_i': '-inf', 'input_tp': '-inf', 'target_offset': 'inf'},
    {'input_i': '-100'}, {'input_tp': 'nan'}, {'target_offset': '100'},
])
def test_invalid_measurements_never_become_second_pass_arguments(monkeypatch, bad):
    measured = {'input_i': '-20', 'input_tp': '-2', 'input_lra': '5',
                'input_thresh': '-30', 'target_offset': '6', **bad}
    monkeypatch.setattr('yap.render.subprocess.run', lambda *args, **kwargs:
                        SimpleNamespace(returncode=0, stderr=json.dumps(measured)))
    assert _measure_loudness(Path('fixture.mkv')) is None


def test_valid_loudness_measurements_keep_two_pass_normalization(monkeypatch):
    measured = {'input_i': '-20', 'input_tp': '-2', 'input_lra': '5',
                'input_thresh': '-30', 'target_offset': '6'}
    monkeypatch.setattr('yap.render.subprocess.run', lambda *args, **kwargs:
                        SimpleNamespace(returncode=0, stderr=json.dumps(measured)))
    assert _measure_loudness(Path('fixture.mkv')) == measured


@pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='FFmpeg required')
@pytest.mark.parametrize('width,height,draft,expected_shape', [
    (128, 72, False, (128, 72)), (1080, 1080, True, (960, 960)),
])
def test_real_silent_video_exports_with_silent_audio_and_correct_duration(tmp_path, width, height, draft, expected_shape):
    project = Project(tmp_path)
    source = tmp_path / 'silent.mkv'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=128x72:r=10',
                    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.5',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', str(source)], check=True)
    assert _measure_loudness(source) is None
    project.save({'sources': [{'id': 'silent', 'path': str(source), 'duration': .5, 'fps': 10}]})
    write_json(project.cut_dir('v1') / 'timeline.json', {
        'version': 'v1', 'duration': .5, 'fps': 10, 'width': width, 'height': height,
        'segments': [{'source': 'silent', 'start': 0, 'end': .5, 'out_start': 0, 'out_end': .5}],
    })
    output = render(project, 'v1', draft=draft)
    assert output.is_file() and output.stat().st_size > 0
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                              '-show_format', '-of', 'json', str(output)]))
    assert {s['codec_type'] for s in info['streams']} == {'video', 'audio'}
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    assert (video['width'], video['height']) == expected_shape
    assert float(info['format']['duration']) == pytest.approx(.5, abs=.05)
    decoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(output), '-vn', '-f', 'f32le', '-'])
    samples = array.array('f', decoded)
    assert samples and max(map(abs, samples)) < 1e-6
