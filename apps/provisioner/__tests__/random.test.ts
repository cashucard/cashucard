import {randomUuid} from '../src/random';

test('request UUIDs use the platform CSPRNG and preserve canonical version/variant bits', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const getRandomValues = jest.fn((bytes: Uint8Array) => bytes.fill(255));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {getRandomValues},
  });
  try {
    expect(randomUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'crypto', original);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  }
});
