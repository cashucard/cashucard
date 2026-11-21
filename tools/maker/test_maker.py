"""tools/maker/maker.py against the rules: the shared repository's maker file, every vector of
spec/vectors/tag-address.json, the refusals, and the gp command it gives. No card, no reader.

    python3 tools/maker/test_maker.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import maker  # noqa: E402

VECTORS = json.load(open(os.path.join(maker.ROOT, 'spec', 'vectors', 'tag-address.json')))
GOOD = {'example': False, 'name': 'A card maker', 'tagAddress': 'https://cards.example.net/c',
        'securityDomain': {'aid': 'A00000015153504341534400', 'dapPublicKey': '04AB'}, 'designCodes': []}


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = maker.main(list(argv))
    return code, out.getvalue().strip(), err.getvalue().strip()


def written(value):
    f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
    json.dump(value, f)
    f.close()
    return f.name


def test_the_shared_file_is_the_neutral_example():
    m = maker.load()
    assert m['example'] is True and m['tagAddress'] == 'https://example.com/card'
    assert m['securityDomain'] is None and m['designCodes'] == []
    code, out, _ = run('check')
    assert code == 0 and '(the example file)' in out, out


def test_vectors():
    for v in VECTORS['valid']:
        assert maker.tag_address_problem(v['address']) is None, v
        assert maker.tag_params(v['address']).hex() == v['hex']
    for v in VECTORS['invalid']:
        address = bytes.fromhex(v['hex']).decode('latin-1')
        assert maker.tag_address_problem(address), v['why']
        try:
            maker.parse(dict(GOOD, tagAddress=address))
        except maker.MakerError as e:
            assert 'tagAddress' in str(e)
        else:
            raise AssertionError(v['why'])


def test_the_example_is_refused_for_an_install():
    code, out, err = run('tag-params')
    assert code == 1 and not out and 'example' in err, err
    code, out, _ = run('tag-params', '--allow-example')
    assert code == 0 and out == b'https://example.com/card'.hex().upper()


def test_a_makers_file():
    path = written(GOOD)
    try:
        code, out, _ = run('gp-tag', '--file', path)
        assert code == 0
        assert out == ('gp --create D2760000850101 --package F0434153485543415244 --applet F043415348554341524454 '
                       '--params %s --to A00000015153504341534400' % b'https://cards.example.net/c'.hex().upper()), out
    finally:
        os.unlink(path)


def test_refusals():
    bad = [([], 'not a JSON object'), (dict(GOOD, extra=1), 'unknown field'), (dict(GOOD, example='no'), 'example'),
           (dict(GOOD, name=''), 'name'), (dict(GOOD, name='   '), 'name'), (dict(GOOD, name='A\x1cB'), 'name'),
           (dict(GOOD, name='A\tB'), 'name'), (dict(GOOD, name='x' * 65), 'name'), (dict(GOOD, securityDomain={'aid': 'a0000001'}), 'securityDomain.aid'),
           (dict(GOOD, securityDomain={'aid': 'A0000001515353', 'dapPublicKey': 'secret'}), 'dapPublicKey'),
           (dict(GOOD, designCodes=['fx1']), 'designCodes'), (dict(GOOD, designCodes=['ZZ1', 'ZZ1']), 'designCodes'),
           ({k: v for k, v in GOOD.items() if k != 'tagAddress'}, 'no tagAddress')]
    for value, why in bad:
        try:
            maker.parse(value)
        except maker.MakerError as e:
            assert why in str(e), (why, str(e))
        else:
            raise AssertionError(why)
    code, _, err = run('check', '--file', '/nonexistent/maker.json')
    assert code == 1 and 'no file at' in err


def test_design_codes_are_checked_against_the_registry():
    designs = maker.registered_designs()
    assert designs, 'docs/CARD-DESIGNS.md lists codes'
    code, whose = next(iter(designs.items()))
    assert maker.design_problems(dict(GOOD, name=whose, designCodes=[code])) == []
    assert maker.design_problems(dict(GOOD, designCodes=[code]))
    assert maker.design_problems(dict(GOOD, designCodes=['QQ9']))


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            fn()
            print('ok', name)
