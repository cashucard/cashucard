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
      const stored = await hasher.hash('public test password');
      expect(stored).toMatch(/^pbkdf2\$600000\$/);
      expect(await hasher.verify('public test password', stored)).toBe(true);
    } finally {
      derive.mockRestore();
    }
  },
);
