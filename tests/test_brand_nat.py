"""Recipe persistence, validation and export/preview semantics."""
import copy

import pytest

from yap.project import Project, YapError, write_json
from yap.visuals import brand_nat_settings, catalog, load_config, validate, visual_plan


@pytest.fixture
def project(tmp_path):
    return Project(tmp_path)


@pytest.fixture
def timeline():
    return {"version": "v1", "width": 432, "height": 768, "fps": 24, "duration": 8,
            "segments": [{"source": "camera", "start": 0, "end": 8, "out_start": 0, "out_end": 8}]}


def test_each_look_resolves_its_own_defaults_without_mutating_catalog(project, timeline):
    before = copy.deepcopy(catalog())
    presets = [s for s in [*before['styles'], *before['legacyStyles']] if s.get('brandNat')]
    assert len(presets) == 5
    for style in presets:
        result = validate(project, timeline, {'preset': style['id']})
        assert result['brandNat'] == style['brandNat']
        assert result['effects'] == []
        result['brandNat']['title'] = 'A new story'
    assert catalog() == before


@pytest.mark.parametrize('field,value', [
    ('caption', 'C10'), ('hook', 'H6'), ('layout', 'L9'), ('finish', 'G8'),
    ('position', 'middle'), ('title', 12), ('title', 'a' * 121),
    ('subtitle', False), ('subtitle', 'a' * 101), ('emphasis', False), ('emphasis', 'a' * 161), ('music', 'S3'),
])
def test_unimplemented_or_invalid_options_are_not_silently_accepted(project, timeline, field, value):
    with pytest.raises(YapError):
        validate(project, timeline, {'preset': 'nat-editorial', 'brandNat': {field: value}})


@pytest.mark.parametrize('bad', [None, [], 'H10 C9', True])
def test_recipe_requires_an_object(project, timeline, bad):
    with pytest.raises(YapError, match='object'):
        validate(project, timeline, {'preset': 'nat-editorial', 'brandNat': bad})


def test_non_nat_look_does_not_accept_ignored_recipe(project, timeline):
    with pytest.raises(YapError, match='editable Yap look'):
        validate(project, timeline, {'preset': 'volt', 'brandNat': {'caption': 'C9'}})


def test_customization_survives_project_defaults_and_cut_override(project, timeline):
    write_json(project.root / 'style.json', {'visual_defaults': {
        'preset': 'nat-clean', 'motion': 'subtle', 'brandNat': {
            'caption': 'C7', 'title': '  A real title  ', 'subtitle': 'My own words', 'position': 'top', 'emphasis': '  story, idea  '}}})
    first = load_config(project, 'v1', timeline)
    assert first['brandNat']['caption'] == 'C7'
    assert first['brandNat']['title'] == 'A real title'
    assert first['brandNat']['emphasis'] == 'story, idea'
    write_json(project.cut_dir('v1') / 'visuals.json', {**first, 'brandNat': {
        **first['brandNat'], 'caption': 'C3', 'hook': 'none'}})
    assert load_config(project, 'v1', timeline)['brandNat']['caption'] == 'C3'
    assert load_config(project, 'v2', timeline)['brandNat']['caption'] == 'C7'


def test_every_exposed_recipe_option_is_accepted(project, timeline):
    for field, options in catalog()['brandNat']['options'].items():
        for option in options:
            got = validate(project, timeline, {'preset': 'nat-editorial', 'brandNat': {field: option['code']}})
            assert got['brandNat'][field] == option['code']


def test_export_carries_recipe_and_hook_age_and_only_requests_required_masks(project, timeline, monkeypatch):
    import yap.visuals as visuals
    monkeypatch.setattr(visuals, 'face_measurements', lambda *a: {'chin': 400, 'eyes': 220})
    monkeypatch.setattr('yap.overlays.output_words', lambda *a: [{'text': 'Actual', 'start': 0, 'end': .5}])
    calls = []
    mask = {'dir': 'masks', 'fps': 15, 'count': 120}
    monkeypatch.setattr(visuals, 'prepare_matte', lambda *a: calls.append(a) or mask)
    write_json(project.cut_dir('v1') / 'timeline.json', timeline)
    def plan(recipe, offset=0):
        cfg = validate(project, timeline, {'preset': 'nat-editorial', 'brandNat': recipe})
        return visual_plan(project, 'v1', project.root / 'plate.mp4', project.root / 'work',
                           timeline, cfg, {'captions': True}, False, offset)
    standard = plan({'caption': 'C9', 'title': 'My actual title'})
    assert standard['brandNat']['title'] == 'My actual title'
    assert standard['words'][0]['text'] == 'Actual'
    assert standard['mask'] is None
    assert plan({'hook': 'H1'})['mask'] == mask
    later = plan({'hook': 'H1'}, offset=4)
    assert later['mask'] is None and later['timelineOffset'] == 4
    assert plan({'hook': 'none', 'finish': 'G6'}, offset=4)['mask'] == mask
    assert len(calls) == 2


def test_trimmed_preview_keeps_automatic_title_from_start_of_full_cut(project, timeline, monkeypatch):
    import yap.visuals as visuals
    monkeypatch.setattr(visuals, 'face_measurements', lambda *a: {'chin': 400, 'eyes': 220})
    full_words = [{'text': text, 'start': i / 3, 'end': (i + 1) / 3}
                  for i, text in enumerate('Your next good idea deserves a great edit'.split())]
    monkeypatch.setattr('yap.overlays.output_words', lambda _project, tl:
                        full_words[3:] if tl.get('trimmed') else full_words)
    write_json(project.cut_dir('v1') / 'timeline.json', timeline)
    config = validate(project, timeline, {'preset': 'nat-editorial'})
    plan = visual_plan(project, 'v1', project.root / 'plate.mp4', project.root / 'work',
                       {**timeline, 'trimmed': True}, config, {'captions': True}, False, offset=1)
    assert plan['words'][0]['text'] == 'idea'
    assert plan['brandNat']['title'] == 'Your next good idea'
    assert plan['brandNat']['subtitle'] == 'deserves a great edit'
    assert config['brandNat']['title'] == ''
