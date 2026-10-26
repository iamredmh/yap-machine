import shutil
import subprocess

import numpy as np
import pytest

from yap.overlays import resolve_caption_style
from yap.project import Project, write_json
from yap.reframe import faces


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='FFmpeg required')
@pytest.mark.parametrize('width,height', [(128,224), (224,128), (160,160)])
def test_face_detection_receives_undistorted_source_and_replaces_legacy_cache(tmp_path, monkeypatch, width, height):
    source=tmp_path/'camera.mkv'
    subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',
                    f'color=black:s={width}x{height}:r=4:d=1,drawbox=x=48:y=48:w=32:h=32:color=white:t=fill',
                    '-c:v','ffv1',str(source)],check=True)
    project=Project(tmp_path)
    src={'id':'camera','path':str(source),'width':width,'height':height}
    write_json(tmp_path/'cache/camera.faces.json',{'0':[.1,.1,.1]})
    observations=[]
    class Detector:
        def detectMultiScale(self, gray, *args, **kwargs):
            ys,xs=np.where(gray>200)
            w,h=int(xs.max()-xs.min()+1),int(ys.max()-ys.min()+1)
            observations.append((w,h))
            return [(int(xs.min()),int(ys.min()),w,h)]
    monkeypatch.setattr('yap.reframe._detector',lambda:Detector())
    samples=faces(project,src,0,.5)
    assert samples and observations
    assert all(abs(w-h)<=1 for w,h in observations), 'A square must stay square before face detection'
    assert samples[0][1:] == pytest.approx((64/width,64/height,32/height),abs=.01)
    assert (tmp_path/'cache/camera.faces-v2.json').exists()


def test_shared_caption_style_clears_chin_and_retains_phone_safe_area(tmp_path):
    project=Project(tmp_path)
    timeline={'width':432,'height':768,'segments':[{'face_bottom':.7463}]}
    caption=resolve_caption_style(project,timeline,{'preset':'short'})
    top=caption['y']-caption['size']*432*1.2/768
    assert top >= .7463+.025-.0001
    assert caption['y']<=.84
    assert resolve_caption_style(project,{**timeline,'segments':[]},{'preset':'short'})['y']==.72
