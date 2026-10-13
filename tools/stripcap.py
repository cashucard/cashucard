#!/usr/bin/env python3
"""Take the Descriptor and Debug components out of a CAP file, in place.

A CAP file is a zip of components. The Descriptor and Debug components are for
tools that read the file off the card (verifiers, debuggers); the Java Card
virtual machine specification says neither need be loaded onto a card, and the
loader GlobalPlatformPro sends the Descriptor all the same. The chip the card
runs on keeps nothing of it: the same file installs with it and without it, and
it has no part in the size the chip is particular about
(docs/FOXY-CARD-HARDWARE.md). So the build takes it out, which shortens the
load by about three kilobytes, and writes 0 for it in the Directory component's
table of sizes, as the specification has it for a component that is not there.

    python3 tools/stripcap.py applet/target/cashu-javacard-0.1.0.cap
"""
import sys
import zipfile

# the Directory component: a tag (1), its size (2), then twelve sizes of two bytes each, in this order
COMPONENTS = ['Header', 'Directory', 'Applet', 'Import', 'ConstantPool', 'Class', 'Method',
              'StaticField', 'RefLocation', 'Export', 'Descriptor', 'Debug']
STRIPPED = ('Descriptor', 'Debug')


def strip(path):
    with zipfile.ZipFile(path) as zin:
        items = [(i, zin.read(i.filename)) for i in zin.infolist()]
    present = {}
    for item, data in items:
        name = item.filename.split('/')[-1]
        if name.endswith('.cap'):
            present[name[:-4]] = len(data)
    taken = [c for c in STRIPPED if c in present]
    if not taken:
        print('stripcap: nothing to take out of %s' % path)
        return
    out = []
    for item, data in items:
        name = item.filename.split('/')[-1]
        if name[:-4] in STRIPPED and name.endswith('.cap'):
            continue
        if name == 'Directory.cap':
            b = bytearray(data)
            for c in taken:
                at = 3 + 2 * COMPONENTS.index(c)
                said = (b[at] << 8) | b[at + 1]
                # the Directory counts a component without its own three-byte head
                if said != present[c] - 3:
                    raise SystemExit('stripcap: the Directory says %s is %d bytes, the file has %d' % (c, said, present[c] - 3))
                b[at] = 0
                b[at + 1] = 0
            data = bytes(b)
        out.append((item, data))
    tmp = path + '.stripped'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item, data in out:
            zout.writestr(item, data)
    import os
    os.replace(tmp, path)
    print('stripcap: took %s out of %s (%s bytes)' % (' and '.join(taken), path, ' and '.join(str(present[c]) for c in taken)))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    strip(sys.argv[1])
