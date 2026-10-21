import {expect, it, vi} from 'vitest';
import {SubtlePwHash} from '../../src/pwhash';

it(
  'the deployed iteration-cap fallback runs inside workerd',
  {timeout: 30_000},
  async () => {
    const derive = vi
      .spyOn(crypto.subtle, 'deriveBits')
      .mockRejectedValue(
        new DOMException(
          'Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).',
          'NotSupportedError',
        ),
      );
    try {
      const hasher = new SubtlePwHash();
      // Native Node PBKDF2 vector; random salt/format and wrong-password
      // coverage live in the Node test, avoiding two costly KDFs here.
      const stored =
        'pbkdf2$600000$5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a$d8a3173efab35d6516381d924cdb32a759fc656c55e20fb38295ab50ea5a60de7952c0ea4e4e08b5fe9b40a7451145f6b78a43390a8b3a39d5607695e677882f';
      expect(await hasher.verify('public test password', stored)).toBe(true);
    } finally {
      derive.mockRestore();
    }
  },
);
