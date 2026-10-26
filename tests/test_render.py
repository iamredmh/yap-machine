import array
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from yap.project import Project, write_json
from yap.render import _measure_loudness, render


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
def test_real_silent_video_exports_with_silent_audio_and_correct_duration(tmp_path):
    project = Project(tmp_path)
    source = tmp_path / 'silent.mkv'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=128x72:r=10',
                    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.5',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', str(source)], check=True)
    assert _measure_loudness(source) is None
    project.save({'sources': [{'id': 'silent', 'path': str(source), 'duration': .5, 'fps': 10}]})
    write_json(project.cut_dir('v1') / 'timeline.json', {
        'version': 'v1', 'duration': .5, 'fps': 10, 'width': 128, 'height': 72,
        'segments': [{'source': 'silent', 'start': 0, 'end': .5, 'out_start': 0, 'out_end': .5}],
    })
    output = render(project, 'v1')
    assert output.is_file() and output.stat().st_size > 0
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                              '-show_format', '-of', 'json', str(output)]))
    assert {s['codec_type'] for s in info['streams']} == {'video', 'audio'}
    assert float(info['format']['duration']) == pytest.approx(.5, abs=.05)
    decoded = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(output), '-vn', '-f', 'f32le', '-'])
    samples = array.array('f', decoded)
    assert samples and max(map(abs, samples)) < 1e-6
