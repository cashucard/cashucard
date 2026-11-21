#!/usr/bin/env python3
"""What the chip asks of the built card file, checked after every build.

Two things, both found on the chip (docs/CASHU-CARD-HARDWARE.md):

1. The J3R180 the card is built on fails the INSTALL that both instantiates a
   package for the first time and runs a heavy constructor (6F00, or no answer
   at all). It takes the card's applet once a small applet has been
   instantiated from the package before it. So the file's Applet component
   must list the opener first, and the two are installed in that order
   (docs/HARDWARE_DEPLOYMENT.md). From software 1.19 the file lists a third applet,
   the NFC tag, last: it is made after the card's, under the NFC Forum's own name.

2. Even then, the card's applet installs at some sizes of the load file and
   not at others, and the same code fails a few dozen bytes to either side of
   a size that works. The rule is not known: it looked like a window of each
   256 bytes (130 to 186 past a multiple) for files of 17.3 to 17.7 KB, and
   files of 18.1 to 18.5 KB install at 203 and 249 past and fail at 139 to
   176. So this check keeps what has been measured on the chip (SIZES) and
   says which it is: a size known to install, a size known to fail, or one
   not tried yet. `CashuApplet.sizeTheFile` is in the package for its length
   alone, five to seven bytes a line (an index above 127 takes a byte more),
   so that a build can be moved to a size known to install; a size not tried
   yet is tried on a chip, and the answer added here. A build inside a range around a size that failed (AVOID) is
   refused whatever SIZES says.

A size in SIZES says what a chip did with some source padded to that size, not
that this file has run: whether this exact file has run on a chip is said by
its load file's sha256 (`load_file`, the bytes gp LOADs), in PROVEN. A hash
goes on PROVEN only once the chip run that installs that exact file has had
real signatures and real change verified on the chip, and its entry says so in
PROVEN_NEEDS's words (a file installed by a chip run but not yet paid with at a mint is on INSTALLED instead); refcheck refuses to run while an entry does not (the two
entries made before the rule, EARLIER, excepted). The sentence the guides give
of the file is said(), worked out from PROVEN and SIZES.

    python3 tools/refcheck.py <file.cap>
"""
import hashlib
import sys
import zipfile

OPENER = bytes.fromhex('F04341534855434152444D')
LOADED = ['Header', 'Directory', 'Import', 'Applet', 'Class', 'Method',
          'StaticField', 'Export', 'ConstantPool', 'RefLocation']
# what the chip has answered, by the load file's size (refcheck's measure, the stored components): True installed,
# False went 6F00 or mute at INSTALL. Measured on a J3R180 with the opener first.
SIZES = {
    17344: False, 17438: False, 17479: False, 17480: False, 17538: True, 17552: True, 17560: True, 17562: True,
    17564: True, 17575: True, 17582: True, 17589: True, 17677: False, 17694: False, 17726: False,
    18123: True, 18315: False, 18337: False, 18340: False, 18352: False, 18425: True, 18486: True,
    19267: True, 19269: True, 19280: True,
    19634: True,
    20060: True,  # v2.0.0-rc.1 (sha256 59f66673...), ENG-681: the install counted 20,057; selftest 12/12
    20068: True,  # v2.1.0 (sha256 f27d92b...), ENG-699: three steps, opener first; selftest 12/12 (docs/reports/HARDWARE_TEST_REPORT_2026-10-14.j3r180-2.1.md)
    21631: True,  # 2.2 (sha256 86839ccf...), ENG-823, 2026-11-06: three steps, opener first, card applet created in 2.17 s on 09336320; info says 2.2, outbox 6A88 (docs/reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-install-refused.md)
    32777: False,  # 2.3 source padded to this size, 2026-11-13, a J3R180: loaded, opener made, card applet 6F00 at INSTALL, twice
    33647: True,   # 2.3 source padded to this size, 2026-11-13, a J3R180: installed twice; SELECT 0203 and GET_INFO answered
    35213: True,   # 2.3 source padded to this size, 2026-11-13, a J3R180: installed; SELECT 0203 and GET_INFO answered
    35466: True,   # 2.3 (sha256 48b8597c...), unpadded, 2026-11-13, J3R180 09312320: three steps, opener first, load 16 s, card applet 2 s; SELECT 0203, selftest 20/20
    36953: True,   # 2.3 (CAP sha256 30c7bb8d..., load file f216644a...), unpadded, D200 to D204, 2026-11-14, J3R180 09312320: three steps, opener first, load 16 to 17 s, card applet 2 s; SELECT 0203, selftest 20/20, installed three times
    36950: True,   # 2.3 (CAP sha256 01edad4c..., load file 075448e4...), unpadded, D200 to D204 and D211 without the loader's y, 2026-11-14, J3R180 09301220: three steps, opener first, load 16 to 17 s, card applet 2 s at the first create; SELECT 0203, selftest 20/20, installed twice
    37269: True,   # 2.3 (CAP sha256 55614a2f..., load file fe156f4f...), unpadded, D200 to D204, D211 to D212 (LOAD_PROOF's 04 form, C held to the curve by the chip's key agreement), 2026-11-14, J3R180 09301220: three steps, opener first, load 16 to 17 s, card applet 2 to 3 s at the first create, five installs; SELECT 0203, selftest 21/21
    39343: True,   # 2.3 (CAP sha256 b304d938..., load file c79b30a7...), unpadded, D200 to D204, D211 to D216 (D213 keyset taught at set-up, D214 the field on p padded, D215 LOAD_CHANGE's points by the key agreement, D216 e*d on the chip's RSA), 2026-11-14, J3R180 09301220: three steps, opener first, load 17 s, card applet 2 s at the first create, installed three times; SELECT 0203, selftest 20/20
    40365: True,   # 2.3 (CAP sha256 20b6d726..., load file 8aefa0db...), unpadded, D200 to D204, D211 to D220 (D217 the product in two shares, D218 every signature checked on the card, D219 wider known answers, D220 a taught keyset kept), 2026-11-14, J3R180 09301220: three steps, opener first, load 17 to 18 s, card applet 1 to 3 s at the first create, four installs (173 past a multiple of 256; 135 and 153 past failed and 175 and 237 past installed); SELECT 0203, selftest 13/13, real signatures and real change verified on the chip
    40412: True,   # 2.3 (CAP sha256 11104ceb..., load file 05c9b847...), unpadded, D200 to D204, D211 to D221 (the claim after the set-up's record is one asking), 2026-11-15, J3R180 09301220: three steps, opener first, load 17 to 18 s, card applet 2 s; selftest 13/13, set-up claim at the first asking, 9-piece payment with change, installed three times
    41205: True,   # 2.3 with the rotating tag (190c5ab, load file 6f0e3a06..., never tracked), unpadded, 245 past a multiple of 256, J3R180 58206920: installed and left there, selftest 13 of 13 and the tag read (docs/reports/HARDWARE_TEST_REPORT_2026-11-19_58206920.md, its files table and the row Left); not on PROVEN
    41973: True,   # 3.0 of the merge, padded to 245 past a multiple of 256 (1ad208d, load file 2b9c6b02...), J3R180 58206920: created 30 times of 30 at the first try (docs/reports/HARDWARE_TEST_REPORT_2026-11-19_58206920_3.0.md, the install rate test); not on PROVEN
    42485: True,   # neutral 3.0 with the tag's address at install (9ac55c1, load file d69742d0...), J3R180 58206920, 2026-11-21: 13 of 13 installs at the first try, ten create cycles (docs/reports/HARDWARE_TEST_REPORT_2026-11-21_58206920_3.0-neutral.md), then a payment run at testnut on the same card (the same report); on PROVEN
    38791: False,  # 2.3 study build of D213 to D216 (ecdh study, never shipped), 2026-11-14, J3R180 09301220: loaded, opener made, card applet 6F00 at create (135 past a multiple of 256)
    38809: False,  # the same study source at this size, 2026-11-14, J3R180 09301220: card applet 6F00 at create (153 past a multiple of 256)
    38893: True,   # the same study source at this size (load file 92b67948..., never shipped), 2026-11-14, J3R180 09301220: installed at the first try (237 past a multiple of 256); passed the study's chip tests
    35509: True,   # the 2.3 chip run's test-only build (2.3 with one command added that says the signer's temporary key's kind; never shipped, load file sha256 1bf178bc...), 2026-11-13, J3R180 09312320: three steps, opener first, load 16 s, card applet 2 s
    21540: False,  # 2.2 first build (sha256 51ddeee4...), ENG-823, 2026-11-06: loaded (88 blocks), card applet 6F00 at create; cause not isolated: the size window or the constructor's +4,321 B persistent (D176, docs/reports/HARDWARE_TEST_REPORT_2026-11-06.j3r180-2.2-install-refused.md)
}
NEAR = 8  # bytes: a size this close to one that failed is treated as that one
# load-file sizes a build is kept out of (first, last), whatever SIZES says: around 32,777, which failed in 2.3
AVOID = [(32700, 32850)]
# the load files a chip has installed and run, by the sha256 of the bytes LOADed (`load_file`): the chip run that installs a
# file adds its hash here, with its size in SIZES, only once it has had real signatures (a payment a real mint takes,
# AUTH's signature) and real change (a payment's change loaded back and taken by the mint in a later swap) verified on the
# chip, since the framing check's fixed asks do not reach every way a chip may multiply; the entry says so in PROVEN_NEEDS's
# words.
PROVEN = {
    'fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee': '2.1, 20,068 bytes, 2026-10-14',
    '28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3': '2.2, 21,631 bytes, 2026-11-06 (ENG-823)',
    '48b8597cfd23ace73c6451a962541bfa09534a312f225ebcf382a8769fe01c96': '2.3, 35,466 bytes, 2026-11-13, J3R180 09312320 at '
        'testnut.cashu.space: real signatures and real change verified on the chip',
    'f216644a316e4c9de0f8bed2a4f32e90b48fa18624ed95a8f8950503f9464440': '2.3 with D200 to D204, 36,953 bytes, 2026-11-14, J3R180 '
        '09312320 at testnut.cashu.space: real signatures and real change verified on the chip',
    '075448e44e080d05e7dde270ec246e469796083ce7f70cf94c70fc19054d012a': '2.3 with D200 to D204 and D211 (no payment floor, shorter holds), 36,950 bytes, '
        '2026-11-14, J3R180 09301220 at testnut.cashu.space: real signatures and real change verified on the chip',
    'fe156f4f505ccaecefe16aaeee4e270a76909d6373bf78cfd2ff9fd6c28a97e6': '2.3 with D200 to D204, D211 to D212 (the 04 form of LOAD_PROOF, C held to the curve by '
        'the key agreement of the chip), 37,269 bytes, 2026-11-14, J3R180 09301220 at testnut.cashu.space: real signatures and real change '
        'verified on the chip',
    'c79b30a7cf54ce6a97ca5a9f4fba72744618fbe6b42fd03d00b48aa5d508da00': '2.3 with D200 to D204, D211 to D216 (a keyset taught at set-up, the field on '
        'p padded, the points of LOAD_CHANGE by the key agreement, e*d on the RSA of the chip), 39,343 bytes, 2026-11-14, J3R180 09301220 at '
        'testnut.cashu.space: real signatures and real change verified on the chip',
    '8aefa0db7ba81c0c9a3832e33e301110d6fa5d52b7a52a1434eda6ac9ee206aa': '2.3 with D200 to D204, D211 to D220 (D217 the signature\'s product in two shares, D218 every signature checked on the card, D219 the '
        'set-up\'s known answers made wider, D220 a taught keyset kept until its first piece), 40,365 bytes, 2026-11-14, J3R180 09301220 at '
        'testnut.cashu.space: real signatures and real change verified on the chip',
    '05c9b8476313d18e453ebdfb04672296f7d64d825c6e34aff22ef43a3b8d6bc3': '2.3 with D200 to D204, D211 to D221 (D221 the claim after the set-up\'s record is one asking), 40,412 bytes, 2026-11-15, J3R180 09301220 at '
        'testnut.cashu.space: real signatures and real change verified on the chip',
    'd69742d0034f77253882efa1c0f924c0d45bcd067c94cc2a3d05b83b6c834a1e': 'neutral 3.0 (9ac55c1, the tag\'s address at install, D227), 42,485 bytes, '
        '2026-11-21, J3R180 58206920 at testnut.cashu.space: 13 of 13 installs at the first try, then a payment with five change outputs, '
        'the change loaded back and taken by testnut in a later swap, AUTH verified: real signatures and real change verified on the chip',
}
# the load files a chip has installed, by the sha256 of the bytes gp LOADs, whose run has not yet had a payment at a mint: the
# chip run that installs that exact file adds it here, with its size in SIZES; it moves to PROVEN once its run has had real
# signatures and real change verified on the chip. A size in SIZES says what a chip did with some source of that size; an
# entry here says this exact file installed.
INSTALLED = {
}
# what every entry of PROVEN says of its chip run, word for word
PROVEN_NEEDS = 'real signatures and real change verified on the chip'
# the entries made before that rule, listed as they were; no other entry is excepted from it
EARLIER = frozenset({
    'fe7d8ac31be1284f8a9a6d031cdee9b4690f8d02e0a9ab1fa3bac645f6bc13ee',
    '28ddfb9d47af16e565f565149a91fddfa7af94ca4bed0ef686e7a6c2fe0285d3',
})
PAGE = 256
# where in its 256-byte page a load file ended when the chip refused the card's applet (2.3 study builds at 135 and 153 past;
# 1.x builds at 139, 164 and 176 past): refcheck's SIZES compares whole sizes only, so a new size near one of these places is
# warned of, unless that very place has installed (`place_warning`)
REFUSED_PAST = (135, 139, 153, 164, 176)
NEAR_PAST = 8  # bytes either side of a refused place


def place_warning(size):
    """A warning when `size` ends at or within NEAR_PAST bytes of a page place in REFUSED_PAST and no size in SIZES that
    installed ended at that very place, else None."""
    past = size % PAGE
    installed = {s % PAGE for s, ok in SIZES.items() if ok}
    near = [r for r in REFUSED_PAST if abs(past - r) <= NEAR_PAST]
    if not near or past in installed:
        return None
    return ('WARNING: %d past a multiple of %d is %s %d past, where the chip refused the card\'s applet before, and no size '
            'that installed ended here: move CashuApplet.sizeTheFile to a place known to install (%s past) before a chip run.'
            % (past, PAGE, 'at' if past in near else 'near', near[0], ', '.join(str(x) for x in sorted(installed))))
LINE = 6  # bytes one line of sizeTheFile adds, about: five to seven, so the lines advised are an estimate


def components(path):
    out = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith('.cap'):
                out[n.rsplit('/', 1)[-1][:-4]] = z.read(n)
    return out


def applets(component):
    """The AIDs the Applet component lists, in order."""
    count = component[3]
    out, at = [], 4
    for _ in range(count):
        n = component[at]
        out.append(component[at + 1:at + 1 + n])
        at += 1 + n + 2
    return out


def load_file_size(parts):
    body = sum(len(parts[k]) for k in LOADED if k in parts)
    return body + (2 if body < 0x80 else 3 if body < 0x100 else 4)


def load_file(parts):
    """The bytes gp LOADs: C4, the BER length of the components, and the components in LOADED's order."""
    body = b''.join(parts[k] for k in LOADED if k in parts)
    n = len(body)
    head = bytes([0xC4, n]) if n < 0x80 else bytes([0xC4, 0x81, n]) if n < 0x100 else bytes([0xC4, 0x82, n >> 8, n & 0xFF])
    return head + body


def unverified():
    """The entries of PROVEN that do not say PROVEN_NEEDS (EARLIER excepted): a hash added without real signatures and
    real change verified on the chip."""
    return sorted(h for h, note in PROVEN.items() if h not in EARLIER and PROVEN_NEEDS not in note)


def proven(parts):
    """Whether this exact load file has run on a chip: its sha256 is in PROVEN, and its entry says PROVEN_NEEDS (or is
    one of EARLIER)."""
    sha = hashlib.sha256(load_file(parts)).hexdigest()
    return sha in PROVEN and (sha in EARLIER or PROVEN_NEEDS in PROVEN[sha])


def installed(parts):
    """Whether this exact file has been installed by a chip run and is not yet proven: its sha256 is in INSTALLED."""
    return not proven(parts) and hashlib.sha256(load_file(parts)).hexdigest() in INSTALLED


def said(parts):
    """The sentence the guides give of this exact file, worked out from PROVEN, INSTALLED and SIZES."""
    if proven(parts):
        return 'this exact file has run on a chip'
    if installed(parts):
        return 'this exact file has been installed on a chip, and has not yet been proven with a payment at a mint'
    if SIZES.get(load_file_size(parts)):
        return 'this exact file has run only in a simulator so far, and no card has installed it'
    return 'this exact file has run only in a simulator so far, and no card has installed it or a file of its size'


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    bare = unverified()
    if bare:
        print('REFUSED: PROVEN lists %s without "%s": a hash goes on PROVEN only once the chip run has had real '
              'signatures and real change verified on the chip, and its entry says so.' % (', '.join(bare), PROVEN_NEEDS))
        return 1
    parts = components(argv[1])
    size = load_file_size(parts)
    past = size % PAGE
    listed = applets(parts['Applet']) if 'Applet' in parts else []
    print('load file: %d bytes (%d past a multiple of %d); applets, in order: %s'
          % (size, past, PAGE, ', '.join(a.hex().upper() for a in listed)))
    print('load file sha256: %s; %s.' % (hashlib.sha256(load_file(parts)).hexdigest(), said(parts)))
    if not listed or listed[0] != OPENER:
        print('REFUSED: the opener (%s) must be the first applet listed, so that it is instantiated first.' % OPENER.hex().upper())
        return 1
    warning = place_warning(size)
    if warning:
        print(warning)
    good = sorted(s for s, ok in SIZES.items() if ok)
    bad = sorted(s for s, ok in SIZES.items() if not ok)
    for first, last in AVOID:
        if first <= size <= last:
            print('REFUSED: a load file of %d bytes is inside %d to %d, a range kept out of because a size in it failed to '
                  'install on a chip. Move CashuApplet.sizeTheFile out of it.' % (size, first, last))
            return 1
    if size in SIZES and SIZES[size]:
        print('a size known to install on the chip.')
        return 0
    close = [s for s in bad if abs(s - size) <= NEAR]
    if close:
        nearest = min(good, key=lambda s: abs(s - size))
        print('REFUSED: a file of %d bytes failed to install on the chip (this one is %d). The nearest size known to install is %d: '
              'move CashuApplet.sizeTheFile by about %d bytes (about %d lines of five to seven bytes), or try this size on a chip and add the answer to SIZES.'
              % (close[0], size, nearest, nearest - size, (abs(nearest - size) + LINE - 1) // LINE))
        return 1
    nearest = min(good, key=lambda s: abs(s - size))
    print('not yet tried on a chip (the nearest size known to install is %d bytes, %+d from this). Try it on a chip before shipping it, and add the answer to SIZES.'
          % (nearest, nearest - size))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
