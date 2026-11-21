#!/usr/bin/env python3
"""The card maker's settings, maker/maker.json, for the host tools and the install commands.

maker/maker.json is the one file that holds what is a card maker's own: its name, the address the card's NFC tag
carries, its security domain and its design codes (maker/README.md). The card's load file holds none of it. This
module checks the file against maker/maker.schema.json's rules, the same rules tools/cardkit/gp/maker.ts applies, and
prints what an install needs from it:

    python3 tools/maker/maker.py check                      the file is valid: say what it holds
    python3 tools/maker/maker.py tag-params                 the tag's install parameters, hex, for gp --params
    python3 tools/maker/maker.py gp-tag                     the whole gp command that makes the tag

`tag-params` and `gp-tag` refuse the shared repository's example file (`"example": true`) unless `--allow-example`
says the card is a spare one on a bench: a card in the field must carry its maker's address, never example.com's.
All three refuse an address that looks as if it names one card (`tag_address_warning`: a run of six digits or more, a
run of eight hex digits or more, a UUID, or `serial` or `uid` in the path or the query) unless `--allow-per-card` is
given. The tag's address is the installer's choice for each card and survives RESET_CARD, so an address of one card is
a tracker a phone without the app hands to the maker's server at every read (D228). This is a guard rail at this tool
only: a gp --params written by hand, or another installer, is not checked, and an address that names a card in a way
the rule does not see passes. The check that holds is the maker's published address (docs/CARD-DESIGNS.md).

`--file` reads another file in place of maker/maker.json (for tests). Python 3.9 or later, the standard library only.
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFAULT = os.path.join(ROOT, 'maker', 'maker.json')
DESIGNS = os.path.join(ROOT, 'docs', 'CARD-DESIGNS.md')

TAG_AID = 'D2760000850101'
TAG_CLASS_AID = 'F043415348554341524454'
PACKAGE_AID = 'F0434153485543415244'
ADDRESS_MAX = 127
HTTPS = 'https://'
BARRED = '"#<>\\^`{|}'
KEYS = ('$schema', 'example', 'name', 'tagAddress', 'securityDomain', 'designCodes')


class MakerError(ValueError):
    """A maker file that breaks a rule; the message names the field and the rule."""

    def __init__(self, message):
        super().__init__('maker/maker.json: ' + message)


def tag_address_problem(address):
    """Why `address` cannot be a tag's address (spec/APDU.md, The NFC tag), or None when it can."""
    if not isinstance(address, str) or not address:
        return 'no tag address: the card maker gives one (maker/maker.json, tagAddress)'
    if not address.startswith(HTTPS):
        return 'the tag address %r does not begin with https:// (in lowercase)' % address
    if len(address) == len(HTTPS):
        return 'the tag address has nothing after https://'
    if len(address) > ADDRESS_MAX:
        return 'the tag address is %d characters; the most is %d, https:// included' % (len(address), ADDRESS_MAX)
    if not re.match(r'[0-9A-Za-z]', address[len(HTTPS)]):
        return 'the tag address must have a letter or a digit right after https://'
    for ch in address:
        if not 0x21 <= ord(ch) <= 0x7E:
            return 'the tag address holds %r: only printable ASCII, no spaces' % ch
        if ch in BARRED:
            return 'the tag address holds %r, which may not stand in it (the card adds the # and its fragment)' % ch
    return None


def tag_address_warning(address):
    """Why `address` looks as if it names one card (D228), or None. A heuristic: a run of six digits or more, a run of
    eight hex digits or more, or a UUID anywhere after https:// (the host compared in lowercase), or `serial` or `uid`
    as a word in the path or the query, in any case. It refuses some innocent addresses (a long number in a path) and
    misses a per-card address that looks innocent; tag_address_problem's rules are the applet's and are separate."""
    if not isinstance(address, str) or not address.startswith(HTTPS):
        return None
    rest = address[len(HTTPS):]
    cut = min([i for i in (rest.find('/'), rest.find('?')) if i >= 0] or [len(rest)])
    host, tail = rest[:cut].lower(), rest[cut:]
    text = host + tail
    if re.search(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', text):
        return 'it holds a UUID'
    if re.search(r'[0-9]{6,}', text):
        return 'it holds a run of six digits or more'
    if re.search(r'[0-9a-fA-F]{8,}', text):
        return 'it holds a run of eight hex digits or more'
    if re.search(r'(?<![a-z])(?:serial|uid(?![a-z]))', tail, re.IGNORECASE):
        return 'its path or query names a serial or a uid'
    return None


def tag_params(address):
    """The tag's install parameters, the value of C9: the address's ASCII bytes. Raises MakerError on a bad address."""
    problem = tag_address_problem(address)
    if problem:
        raise MakerError('tagAddress: ' + problem)
    return address.encode('ascii')


def parse(value):
    """The settings in `value` (the parsed file), checked; raises MakerError naming what is wrong."""
    if not isinstance(value, dict):
        raise MakerError('not a JSON object')
    for key in value:
        if key not in KEYS:
            raise MakerError('unknown field %s' % json.dumps(key))
    for key in KEYS[1:]:
        if key not in value:
            raise MakerError('no ' + key)
    if not isinstance(value['example'], bool):
        raise MakerError('example is true or false')
    name = value['name']
    if (not isinstance(name, str) or len(name) > 64 or re.search(r'[\x00-\x1f\x7f]', name)
            or not re.search(r'[^\s]', name)):
        raise MakerError('name is 1 to 64 characters, no control characters, not only spaces')
    problem = tag_address_problem(value['tagAddress'])
    if problem:
        raise MakerError('tagAddress: ' + problem)
    domain = value['securityDomain']
    if domain is not None:
        if not isinstance(domain, dict):
            raise MakerError('securityDomain is null or an object')
        for key in domain:
            if key not in ('aid', 'dapPublicKey'):
                raise MakerError('securityDomain: unknown field %s' % json.dumps(key))
        if not isinstance(domain.get('aid'), str) or not re.fullmatch(r'(?:[0-9A-F]{2}){5,16}', domain['aid']):
            raise MakerError('securityDomain.aid is 5 to 16 bytes of upper-case hex')
        if 'dapPublicKey' in domain and (not isinstance(domain['dapPublicKey'], str)
                                         or not re.fullmatch(r'(?:[0-9A-F]{2})+', domain['dapPublicKey'])):
            raise MakerError('securityDomain.dapPublicKey is upper-case hex (the public key only)')
    codes = value['designCodes']
    if (not isinstance(codes, list) or any(not isinstance(c, str) or not re.fullmatch(r'[0-9A-Z]{3}', c) for c in codes)
            or len(set(codes)) != len(codes)):
        raise MakerError('designCodes is a list of distinct codes, three capital letters or digits each')
    return {k: value[k] for k in KEYS[1:]}


def load(path=DEFAULT):
    """maker/maker.json (or `path`), read and checked. A missing file or bad JSON is a MakerError that says so."""
    if not os.path.exists(path):
        raise MakerError('no file at %s: copy the shared repository\'s maker/maker.json and give your own values '
                         '(maker/README.md)' % path)
    try:
        with open(path, encoding='utf-8') as f:
            value = json.load(f)
    except ValueError as e:
        raise MakerError('not valid JSON (%s)' % e)
    return parse(value)


def registered_designs(path=DESIGNS):
    """{code: whose} from docs/CARD-DESIGNS.md's table."""
    out = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'^\|\s*([0-9A-Z]{3})\s*\|[^|]*\|\s*([^|]+?)\s*\|', line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


def design_problems(maker, path=DESIGNS):
    """The maker's design codes that docs/CARD-DESIGNS.md does not list as this maker's."""
    designs = registered_designs(path)
    return ['%s is not in docs/CARD-DESIGNS.md' % c if c not in designs
            else '%s is registered to %s, not %s' % (c, designs[c], maker['name'])
            for c in maker['designCodes'] if designs.get(c) != maker['name']]


def gp_tag(maker):
    """The gp command that makes the tag under the NFC Forum's name with the maker's address (HARDWARE_DEPLOYMENT.md)."""
    cmd = 'gp --create %s --package %s --applet %s --params %s' % (
        TAG_AID, PACKAGE_AID, TAG_CLASS_AID, tag_params(maker['tagAddress']).hex().upper())
    if maker['securityDomain']:
        cmd += ' --to %s' % maker['securityDomain']['aid']
    return cmd


def main(argv=None):
    p = argparse.ArgumentParser(prog='maker.py', description=__doc__.split('\n\n')[0])
    p.add_argument('command', choices=('check', 'tag-params', 'gp-tag'))
    p.add_argument('--file', default=DEFAULT, help='a maker file other than maker/maker.json')
    p.add_argument('--allow-example', action='store_true',
                   help='a spare card on a bench: use the example file\'s address (example.com) all the same')
    p.add_argument('--allow-per-card', action='store_true',
                   help='take a tag address that looks as if it names one card (D228) all the same')
    args = p.parse_args(argv)
    try:
        maker = load(args.file)
        warning = tag_address_warning(maker['tagAddress'])
        if warning and not args.allow_per_card:
            raise MakerError('tagAddress %r looks as if it names one card (%s). The address is the same on every card '
                             'of a maker and survives a reset: one per card is a tracker that every phone reading the '
                             'tag hands to the address\'s server (D228). Give the maker\'s one address, or pass '
                             '--allow-per-card if it names no card' % (maker['tagAddress'], warning))
        if args.command == 'check':
            problems = design_problems(maker)
            if problems:
                raise MakerError('designCodes: ' + '; '.join(problems))
            print('%s%s: tag %s, %s, designs %s' % (
                maker['name'], ' (the example file)' if maker['example'] else '', maker['tagAddress'],
                'security domain ' + maker['securityDomain']['aid'] if maker['securityDomain'] else 'the card manager',
                ', '.join(maker['designCodes']) or 'none'))
            return 0
        if maker['example'] and not args.allow_example:
            raise MakerError('this is the shared repository\'s example ("example": true), whose tag says example.com: '
                             'give your own maker file, or pass --allow-example for a spare card on a bench')
        print(tag_params(maker['tagAddress']).hex().upper() if args.command == 'tag-params' else gp_tag(maker))
        return 0
    except MakerError as e:
        print('maker.py: %s' % e, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
