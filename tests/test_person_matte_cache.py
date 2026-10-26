from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import time

import cv2
import numpy as np
import pytest

from yap.project import YapError
import yap.visuals as visuals


@pytest.fixture
def pipeline(tmp_path, monkeypatch):
    studio = tmp_path / 'studio'
    studio.mkdir()
    source = studio / 'person-mask.swift'
    source.write_text('// test segmentation version one')
    plate = tmp_path / 'plate.mp4'
    plate.write_bytes(b'immutable video fixture')
    work = tmp_path / 'cache' / 'render'
    state = {'calls': [], 'omit': False, 'fail': False, 'delay': 0}
    monkeypatch.setattr(visuals, 'studio_dir', lambda: studio)
    monkeypatch.setattr(visuals, 'person_matte_capability', lambda: {'available': True, 'reason': None})

    def run(args):
        state['calls'].append(args)
        if args[0] == 'ffmpeg':
            frame_dir = Path(args[-1]).parent
            for i in range(1, 5):
                cv2.imwrite(str(frame_dir / f'{i:06d}.png'), np.full((24, 32), i * 40, np.uint8))
        elif args[0] == 'swiftc':
            Path(args[-1]).write_bytes(b'compiled test binary')
        else:
            # The destination must remain private until all masks are complete.
            frame_dir, masks = map(Path, args[1:])
            assert masks.parent.name.startswith('.pending-')
            time.sleep(state['delay'])
            for frame in sorted(frame_dir.glob('*.png')):
                if state['omit'] and frame.name == '000003.png':
                    continue
                shutil.copyfile(frame, masks / frame.name)
            if state['fail']:
                raise YapError('segmentation interrupted')
    monkeypatch.setattr(visuals, 'run', run)
    return plate, work, source, state


def test_masks_keep_output_frame_rate_and_reuse_only_a_complete_cache(pipeline):
    plate, work, _, state = pipeline
    result = visuals.prepare_matte(plate, work, 29.97)
    assert result['fps'] == 29.97 and result['count'] == 4
    assert (result['width'], result['height']) == (32, 24)
    assert result['version'] == visuals.PERSON_MATTE_VERSION
    ffmpeg = state['calls'][0]
    assert ffmpeg[ffmpeg.index('-vf') + 1] == 'fps=29.97:start_time=0:round=near:eof_action=pass'
    assert not (Path(result['dir']).parent / 'frames').exists()
    calls = len(state['calls'])
    assert visuals.prepare_matte(plate, work, 29.97) == result
    assert len(state['calls']) == calls


def test_cache_key_invalidates_for_frame_rate_source_and_algorithm(pipeline, monkeypatch):
    plate, work, swift, _ = pipeline
    directories = [visuals.prepare_matte(plate, work, 24)['dir'], visuals.prepare_matte(plate, work, 30)['dir']]
    swift.write_text('// updated segmentation algorithm')
    directories.append(visuals.prepare_matte(plate, work, 30)['dir'])
    monkeypatch.setattr(visuals, 'PERSON_MATTE_VERSION', 99)
    directories.append(visuals.prepare_matte(plate, work, 30)['dir'])
    plate.write_bytes(b'replacement video')
    directories.append(visuals.prepare_matte(plate, work, 30)['dir'])
    assert len(set(directories)) == 5


@pytest.mark.parametrize('damage', ['missing', 'corrupt', 'dimensions', 'marker', 'count'])
def test_incomplete_or_corrupt_cache_is_regenerated(pipeline, damage):
    plate, work, _, state = pipeline
    result = visuals.prepare_matte(plate, work, 24)
    mask = Path(result['dir']) / '000002.png'
    done = mask.parent.parent / 'done.json'
    if damage == 'missing':
        mask.unlink()
    elif damage == 'corrupt':
        mask.write_bytes(b'\x89PNG\r\n\x1a\ntruncated')
    elif damage == 'dimensions':
        cv2.imwrite(str(mask), np.zeros((2, 2), np.uint8))
    elif damage == 'marker':
        done.write_text('{invalid')
    else:
        meta = json.loads(done.read_text())
        meta['count'] = 3
        done.write_text(json.dumps(meta))
    before = sum(c[0] == 'ffmpeg' for c in state['calls'])
    restored = visuals.prepare_matte(plate, work, 24)
    assert restored == result
    assert sum(c[0] == 'ffmpeg' for c in state['calls']) == before + 1
    assert cv2.imread(str(mask), cv2.IMREAD_UNCHANGED).shape == (24, 32)


@pytest.mark.parametrize('mode', ['omit', 'fail'])
def test_failed_build_never_publishes_partial_masks_and_can_retry(pipeline, mode):
    plate, work, _, state = pipeline
    state[mode] = True
    with pytest.raises(YapError, match='incomplete|interrupted'):
        visuals.prepare_matte(plate, work, 24)
    cache = work.parent / 'person-masks'
    assert not list(cache.glob('*/done.json'))
    assert not list(cache.glob('.pending-*'))
    state[mode] = False
    assert visuals.prepare_matte(plate, work, 24)['count'] == 4


def test_concurrent_preview_and_export_share_one_complete_generation(pipeline):
    plate, work, _, state = pipeline
    state['delay'] = .03
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(visuals.prepare_matte, plate, work, 24)
        b = pool.submit(visuals.prepare_matte, plate, work, 24)
        assert a.result() == b.result()
    assert sum(c[0] == 'ffmpeg' for c in state['calls']) == 1
    assert len(list((work.parent / 'person-masks').glob('*/done.json'))) == 1


@pytest.mark.parametrize('fps', [0, -1, float('nan'), float('inf'), True, 500])
def test_invalid_frame_rates_do_not_start_segmentation(pipeline, fps):
    plate, work, _, state = pipeline
    with pytest.raises(YapError, match='frame rate'):
        visuals.prepare_matte(plate, work, fps)
    assert not state['calls']
