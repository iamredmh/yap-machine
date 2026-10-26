"""Real media checks: correct edits pass and deliberately displaced media fail."""
import shutil
import subprocess

import pytest

from yap.check import placement
from yap.project import Project, write_json
from yap.render import render

pytestmark = pytest.mark.skipif(not shutil.which('ffmpeg'), reason='FFmpeg required')


def make_cut(tmp_path, fps, start, canvas):
    source = tmp_path / 'camera.mkv'
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=size=128x224:rate={fps}:duration=3',
        '-f', 'lavfi', '-i', 'anoisesrc=seed=41:r=48000:color=pink:duration=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', str(source),
    ], check=True)
    project = Project(tmp_path)
    project.save({'sources': [{'id': 'camera', 'path': str(source), 'duration': 3, 'fps': fps}]})
    timeline = {'version': 'v1', 'duration': 2, 'width': canvas[0], 'height': canvas[1], 'fps': fps,
                'segments': [{'source': 'camera', 'start': start, 'end': start + 2,
                              'out_start': 0, 'out_end': 2, 'zoom': 1}]}
    write_json(project.cut_dir('v1') / 'timeline.json', timeline)
    return project, timeline, render(project, 'v1', jobs=1)


@pytest.mark.parametrize('fps,start,canvas', [
    (24, 0, (224, 128)),
    (25, .4, (128, 224)),
    (30, 0, (128, 128)),
    (60, .4, (224, 128)),
])
def test_placement_accepts_aligned_edits_at_real_frame_rates(tmp_path, fps, start, canvas):
    project, timeline, output = make_cut(tmp_path, fps, start, canvas)
    assert placement(project, output, timeline) == []


@pytest.mark.parametrize('fault', ['audio', 'picture'])
def test_placement_still_detects_real_displacement(tmp_path, fault):
    project, timeline, output = make_cut(tmp_path, 24, 0, (224, 128))
    shifted = tmp_path / f'delayed-{fault}.mp4'
    options = (['-af', 'adelay=80:all=1', '-c:v', 'copy', '-c:a', 'aac'] if fault == 'audio'
               else ['-vf', 'tpad=start_duration=0.125:start_mode=clone', '-c:v', 'libx264', '-c:a', 'copy'])
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(output), *options, '-t', '2', str(shifted)], check=True)
    errors = placement(project, shifted, timeline)
    assert any(('sound' if fault == 'audio' else 'picture') in error for error in errors), errors
    assert not any(('picture' if fault == 'audio' else 'sound') in error for error in errors), errors


@pytest.mark.parametrize('fps', [24, 30, 60])
def test_screen_inset_placement_matches_its_frame_rate_and_crop(tmp_path, fps):
    project, timeline, _ = make_cut(tmp_path, fps, 0, (224, 128))
    data=project.load()
    data['sources'].append({**data['sources'][0], 'id':'display'})
    project.save(data)
    timeline['segments'][0].update(screen={'source':'display','start':0,'crop':[0,.1,1,.75]},
                                   pip=[0,.2,1,128/224])
    write_json(project.cut_dir('v1')/'timeline.json',timeline)
    output=render(project,'v1',jobs=1)
    assert placement(project,output,timeline)==[]
