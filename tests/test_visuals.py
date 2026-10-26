import copy
import math
import pytest
from yap.project import Project, YapError, write_json
from yap.visuals import active, anchor_time, catalog, trim_timeline, validate


@pytest.fixture
def project(tmp_path):
    return Project(tmp_path)


@pytest.fixture
def timeline():
    return {"version":"v1","width":1080,"height":1920,"fps":25,"duration":10,
            "segments":[{"source":"a","start":20,"end":25,"out_start":0,"out_end":5},
                        {"source":"a","start":40,"end":45,"out_start":5,"out_end":10}]}


def effect(**kw):
    return {"id":"one","type":"snap-zoom","at":1,"duration":2,"strength":1,**kw}


def test_catalog_contains_all_six_styles_and_twenty_two_distinct_effects():
    c=catalog()
    assert {s['id'] for s in c['styles']}=={'volt','ledger','sketch','terminal','glass','pop'}
    assert len(c['effects'])==22 and len({e['id'] for e in c['effects']})==22
    assert next(e for e in c['effects'] if e['id']=='text-behind-person')['matte'] is True
    assert next(e for e in c['effects'] if e['id']=='count-up')['matte'] is False


def test_legacy_cut_has_no_visual_pass(project,timeline):
    assert not active(validate(project,timeline,{}))
    assert active(validate(project,timeline,{"preset":"ledger"}))


def test_disabled_effect_does_not_require_its_asset(project,timeline):
    c=validate(project,timeline,{"effects":[effect(type='green-screen',enabled=False)]})
    assert not active(c)


@pytest.mark.parametrize('bad',[float('nan'),float('inf'),-1,True,'later'])
def test_bad_times_fail_before_render(project,timeline,bad):
    with pytest.raises(YapError):validate(project,timeline,{"effects":[effect(at=bad)]})


def test_bounds_and_duplicate_ids(project,timeline):
    with pytest.raises(YapError,match='past the end'):validate(project,timeline,{"effects":[effect(at=9)]})
    with pytest.raises(YapError,match='unique'):validate(project,timeline,{"effects":[effect(),effect()]})


def test_source_anchor_follows_reorder_and_refuses_removed_material(project,timeline):
    e=effect(anchor={"source":"a","time":41})
    assert anchor_time(e,timeline,project)==6
    moved=copy.deepcopy(timeline)
    moved['segments'][1].update(out_start=0,out_end=5)
    assert anchor_time(e,moved,project)==1
    moved['segments']=moved['segments'][:1]
    with pytest.raises(YapError,match='removed'):anchor_time(e,moved,project)


def test_repeated_source_anchor_has_explicit_occurrence(project,timeline):
    timeline['segments'][1].update(start=20,end=25)
    assert anchor_time(effect(anchor={"source":"a","time":21,"occurrence":1}),timeline,project)==6


def test_preview_keeps_source_mapping_and_adjusts_screen_seek(timeline):
    timeline['segments'][0]['screen']={"source":"s","start":70}
    t=trim_timeline(timeline,3,4)
    assert t['duration']==4
    a,b=t['segments']
    assert (a['start'],a['end'],a['out_start'],a['out_end'])==(23,25,0,2)
    assert a['screen']['start']==73
    assert (b['start'],b['end'],b['out_start'],b['out_end'])==(40,42,2,4)
    assert timeline['segments'][0]['start']==20


def test_chart_needs_real_values_and_cut_transition_needs_a_cut(project,timeline):
    with pytest.raises(YapError,match='real values'):validate(project,timeline,{"effects":[effect(type='growth-curve')]})
    with pytest.raises(YapError,match='edit boundary'):validate(project,timeline,{"effects":[effect(type='zoom-through-cut')]})
    c=validate(project,timeline,{"effects":[effect(type='zoom-through-cut',at=4)]})
    assert c['effects'][0]['joinAt']==5


def test_asset_stays_inside_project_even_through_a_symlink(project,timeline,tmp_path):
    outside=tmp_path.parent/'outside-visual.png';outside.write_bytes(b'not relevant')
    (project.root/'uploads').mkdir()
    (project.root/'uploads'/'linked.png').symlink_to(outside)
    for asset in [str(outside),'../outside-visual.png','uploads/linked.png']:
        with pytest.raises(YapError):validate(project,timeline,{"effects":[effect(type='b-roll-overlay',asset=asset)]})


def test_every_effect_can_be_configured(project,timeline):
    (project.root/'uploads').mkdir();(project.root/'uploads'/'test.png').write_bytes(b'asset checked before decoding')
    for kind in catalog()['effects']:
        at=4 if kind['id']=='zoom-through-cut' else 1
        cfg=validate(project,timeline,{"preset":"sketch","effects":[effect(type=kind['id'],at=at,text='My story',asset='uploads/test.png',items=['First','Second'],values=[12,24])]})
        assert cfg['effects'][0]['type']==kind['id']


def test_project_defaults_keep_custom_accent_and_motion(project,timeline):
    from yap.visuals import load_config
    write_json(project.root/'style.json',{'visual_style':'volt','visual_defaults':{'preset':'glass','accent':'#123456','motion':'subtle'}})
    cfg=load_config(project,'v1',timeline)
    assert (cfg['preset'],cfg['accent'],cfg['motion'])==('glass','#123456','subtle')


def test_behind_person_keeps_placement_and_requires_creator_words(project,timeline):
    e=effect(type='text-behind-person',text='My story',textSize=.22,textY=.4)
    assert validate(project,timeline,{'effects':[e]})['effects'][0] == e
    defaults=validate(project,timeline,{'effects':[effect(type='text-behind-person',text='My story')]})['effects'][0]
    assert (defaults['textSize'],defaults['textY']) == (.16,.3)
    for key,value in [('text','  '),('textSize',.01),('textSize',float('nan')),('textY',.99)]:
        with pytest.raises(YapError): validate(project,timeline,{'effects':[{**e,key:value}]})
    validate(project,timeline,{'effects':[effect(type='text-behind-person',enabled=False)]})


@pytest.mark.parametrize('values',[[],[10],[0,10,20],[0,float('nan')],[0,1e13]])
def test_count_up_requires_exactly_two_finite_real_numbers(project,timeline,values):
    with pytest.raises(YapError): validate(project,timeline,{'effects':[effect(type='count-up',values=values)]})


def test_count_up_preserves_fractional_and_descending_totals(project,timeline):
    c=validate(project,timeline,{'effects':[effect(type='count-up',values=[12.5,-3.75],text='Temperature')]})
    assert c['effects'][0]['values']==[12.5,-3.75]


def test_behind_person_requests_masks_only_during_its_enabled_window(project,timeline,monkeypatch):
    import yap.visuals as visuals
    monkeypatch.setattr(visuals,'face_measurements',lambda *args:{})
    monkeypatch.setattr('yap.overlays.output_words',lambda *args:[])
    masks=[]
    mask={'dir':'masks','fps':15,'count':30}
    monkeypatch.setattr(visuals,'prepare_matte',lambda *args: masks.append(args) or mask)
    write_json(project.cut_dir('v1')/'timeline.json',timeline)
    plate=project.root/'plate.mp4';work=project.root/'cache/work'
    row=effect(type='text-behind-person',at=3,duration=2,text='My story')
    def plan(rows,offset=0,length=10):
        return visuals.visual_plan(project,'v1',plate,work,{**timeline,'duration':length},
            {'preset':'original','motion':'balanced','effects':rows},{'captions':False},True,offset)
    live=plan([row],offset=3,length=2)
    assert live['plate']==str(plate) and live['mask']==mask
    assert live['effects'][0]['at']==0 and live['effects'][0]['text']=='My story'
    assert plan([{**row,'enabled':False}])['mask'] is None
    assert plan([row],offset=5,length=2)['mask'] is None
    assert plan([row],offset=0,length=3)['mask'] is None
    assert plan([effect(type='count-up',values=[0,12])])['mask'] is None
    assert len(masks)==1


def test_preview_keeps_a_name_card_from_before_the_preview_and_loops_asset(project,timeline,monkeypatch,tmp_path):
    import json
    from types import SimpleNamespace
    from yap.visuals import render_styled
    import yap.visuals as visuals
    renderer=tmp_path/'renderer';(renderer/'node_modules/@remotion/renderer').mkdir(parents=True)
    write_json(renderer/'catalog.json',catalog())
    monkeypatch.setattr(visuals,'studio_dir',lambda:renderer)
    monkeypatch.setattr(visuals,'face_measurements',lambda *args:{})
    monkeypatch.setattr('yap.media.probe',lambda path:{'duration':.8})
    write_json(project.cut_dir('v1')/'timeline.json',timeline)
    write_json(project.root/'phrases.json',[{'id':'P001','source':'a','start':20}])
    write_json(project.root/'people.json',[{'id':'speaker','name':'Sam','title':'Creator'}])
    write_json(project.transcript_path('a'),{'words':[{'text':'Hello','start':23,'end':23.4}]})
    (project.root/'uploads').mkdir();(project.root/'uploads'/'clip.mp4').write_bytes(b'fixture')
    work=project.root/'cache/test';work.mkdir(parents=True)
    def fake_render(cmd,**kw):
        (work/'styled.mp4').write_bytes(b'fixture')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(visuals.subprocess,'run',fake_render)
    cfg={'preset':'original','motion':'balanced','effects':[effect(type='b-roll-overlay',at=3,asset='uploads/clip.mp4')]}
    render_styled(project,'v1',work/'plate.mkv',work,trim_timeline(timeline,3),cfg,{'captions':True,'lower_thirds':[{'person':'speaker','at':'P001','duration':6}]},True,offset=3)
    plan=json.loads((work/'visuals-render.json').read_text())
    assert plan['thirds'][0]['at']==-3
    assert plan['effects'][0]['assetDuration']==.8
    assert plan['effects'][0]['at']==0
    assert plan['words'][0]['start']==0
    assert plan['captionStyle']['max_words']==3


def test_live_source_reuses_undecorated_cut_and_invalidates_changed_footage(project,timeline,monkeypatch):
    import yap.visuals as visuals
    from yap.visuals import preview_source
    from types import SimpleNamespace
    video=project.root/'camera.mp4';video.write_bytes(b'first source')
    (project.root/'uploads').mkdir()
    (project.root/'uploads'/'agent-background.mp4').write_bytes(b'agent supplied video')
    monkeypatch.setattr('yap.media.probe',lambda path:{'duration':.8})
    project.save({'sources':[{'id':'a','path':str(video)}]})
    write_json(project.cut_dir('v1')/'timeline.json',timeline)
    write_json(project.transcript_path('a'),{'words':[]})
    monkeypatch.setattr(visuals,'face_measurements',lambda *args:{})
    calls=[]
    def cut(project,tl,work,draft):
        calls.append(tl);p=work/'joined.mkv';p.write_bytes(b'joined');return p
    monkeypatch.setattr('yap.render.cut_plate',cut)
    def ffmpeg(cmd,**kwargs):
        from pathlib import Path
        Path(cmd[-1]).write_bytes(b'video')
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(visuals,'run',ffmpeg)
    a=preview_source(project,'v1');b=preview_source(project,'v1')
    assert a['plate']==b['plate'] and len(calls)==1
    assert a['effects']==[] and a['cutBoundaries']==[5]
    assert a['captionStyle']['max_words']==3
    assert a['assetDurations']=={'uploads/agent-background.mp4':.8}
    video.write_bytes(b'replaced longer source')
    c=preview_source(project,'v1')
    assert c['plate']!=a['plate'] and len(calls)==2


@pytest.mark.parametrize('system,version,tools,available,reason',[
    ('linux','',0,False,'Disable cutout effects'),
    ('darwin','11.7.10',0,False,'macOS 12'),
    ('darwin','12.0',0,True,None),
    ('darwin','15.6',1,False,'xcode-select --install'),
])
def test_person_cutout_capability_checks_vision_minimum_and_real_apple_tools(monkeypatch,system,version,tools,available,reason):
    from types import SimpleNamespace
    import yap.visuals as visuals
    monkeypatch.setattr(visuals.sys,'platform',system)
    monkeypatch.setattr(visuals.platform,'mac_ver',lambda:(version,('', '', ''),''))
    calls=[]
    monkeypatch.setattr(visuals.subprocess,'run',lambda *args,**kwargs:calls.append(args) or SimpleNamespace(returncode=tools))
    result=visuals.person_matte_capability()
    assert result['available'] is available
    if reason: assert reason in result['reason']
    else: assert result['reason'] is None
    assert bool(calls) == (system=='darwin' and int(version.split('.')[0])>=12)


def test_unavailable_cutout_fails_before_extracting_or_compiling(project,monkeypatch):
    import yap.visuals as visuals
    monkeypatch.setattr(visuals,'person_matte_capability',lambda:{'available':False,'reason':'Run xcode-select --install'})
    with pytest.raises(YapError,match='xcode-select --install'):
        visuals.prepare_matte(project.root/'does-not-exist.mp4',project.root/'cache/work',24)
