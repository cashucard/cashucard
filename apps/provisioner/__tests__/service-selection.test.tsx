import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {AppStore, useApp} from '../src/store';
import {ApiClient, ApiCancelledError} from '../src/api';
import {normalizeServiceOrigin} from '../src/serviceProfiles';
import type {ServiceProfileStorage} from '../src/serviceProfiles';

let app: ReturnType<typeof useApp>;
let tree: Renderer.ReactTestRenderer;
function Probe() {
  app = useApp();
  return null;
}
function disk(initial: string | null = null) {
  let value = initial;
  const storage: ServiceProfileStorage = {
    read: async () => value,
    write: async v => {
      value = v;
    },
  };
  return {storage, bytes: () => value};
}
async function mount(storage: ServiceProfileStorage) {
  await act(async () => {
    tree = Renderer.create(
      <AppStore
        clientOptions={{baseUrl: 'https://ops.test'}}
        serviceStorage={storage}>
        <Probe />
      </AppStore>,
    );
  });
}
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

test('custom services require a canonical HTTPS origin without credentials or request data', () => {
  expect(normalizeServiceOrigin(' https://OPS.EXAMPLE.COM:443/ ')).toBe(
    'https://ops.example.com',
  );
  expect(normalizeServiceOrigin('https://ops.example.com:8443')).toBe(
    'https://ops.example.com:8443',
  );
  for (const input of [
    'http://ops.example.com',
    'https://name:secret@ops.example.com',
    'https://ops.example.com/api',
    'https://ops.example.com?token=fixture',
    'https://ops.example.com/#x',
    'https://ops.example.com:0',
    'https://ops.example.com:65536',
    'https://ops..example.com',
  ]) {
    expect(() => normalizeServiceOrigin(input)).toThrow();
  }
});

test('selection persists only public origins, restores on restart, and sends login to the selected service', async () => {
  const d = disk();
  await mount(d.storage);
  expect(app.serviceUrl).toBe('https://ops.test');
  await act(async () => app.selectService('https://issuer.example.com'));
  expect(app.serviceUrl).toBe('https://issuer.example.com');
  const auth = jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockImplementation(async function (this: ApiClient) {
      expect(this.options.baseUrl).toBe('https://issuer.example.com');
      return {operator_id: 1, env: 'issued', token: 'private-token'};
    });
  await act(async () => app.signIn('operator', 'private-password'));
  expect(auth).toHaveBeenCalledTimes(1);
  expect(d.bytes()).toContain('https://issuer.example.com');
  expect(d.bytes()).not.toMatch(
    /private-token|private-password|operator_id|operatorName/,
  );
  await act(async () => {
    tree.unmount();
  });
  await mount(d.storage);
  expect(app.serviceUrl).toBe('https://issuer.example.com');
  expect(app.signedIn).toBe(false);
  expect(app.serviceProfiles).toEqual([
    'https://ops.test',
    'https://issuer.example.com',
  ]);
});

test('selecting another service requires signing out and preserves the current connection on failure', async () => {
  const d = disk();
  await mount(d.storage);
  jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockResolvedValue({operator_id: 1, env: 'issued', token: 'token-a'});
  await act(async () => app.signIn('operator', 'fixture'));
  await expect(app.selectService('https://issuer.example.com')).rejects.toThrow(
    /sign out/i,
  );
  expect(app.serviceUrl).toBe('https://ops.test');
  await act(async () => app.signOut());
  d.storage.write = async () => {
    throw new Error('fixture disk failure');
  };
  await act(async () => {
    await expect(
      app.selectService('https://issuer.example.com'),
    ).rejects.toThrow();
  });
  expect(app.serviceUrl).toBe('https://ops.test');
  expect(d.bytes()).toBeNull();
});

test('malformed service preferences block sign-in rather than silently choosing a destination', async () => {
  const storage = disk('{broken').storage;
  await mount(storage);
  expect(app.serviceStatus).toBe('blocked');
  const auth = jest.spyOn(ApiClient.prototype, 'operatorSession');
  await expect(app.signIn('operator', 'fixture')).rejects.toThrow();
  expect(auth).not.toHaveBeenCalled();
  storage.write = async () => {
    throw new Error('fixture write failure');
  };
  await act(async () => {
    await expect(
      app.selectService('https://issuer.example.com'),
    ).rejects.toThrow();
  });
  expect(app.serviceStatus).toBe('blocked');
});

test('a canceled late sign-in cannot adopt a session after switching services', async () => {
  const d = disk();
  await mount(d.storage);
  let finish!: (v: {operator_id: number; env: 'issued'; token: string}) => void;
  jest.spyOn(ApiClient.prototype, 'operatorSession').mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  let login!: Promise<void>;
  await act(async () => {
    login = app.signIn('operator', 'fixture', {signal: controller.signal});
  });
  controller.abort();
  await act(async () => app.selectService('https://issuer.example.com'));
  await act(async () => {
    finish({operator_id: 1, env: 'issued', token: 'old-token'});
    await expect(login).rejects.toBeInstanceOf(ApiCancelledError);
  });
  expect(app.signedIn).toBe(false);
  expect(app.serviceUrl).toBe('https://issuer.example.com');
});

test('authentication posts to the selected origin without carrying the old service token', async () => {
  const storage = disk().storage;
  const fetcher = jest.fn(
    async (_url: string, _options?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          kind: 'operator',
          operator_id: 1,
          env: 'issued',
          token: 'issuer-token',
        }),
      } as Response),
  );
  await act(async () => {
    tree = Renderer.create(
      <AppStore
        serviceStorage={storage}
        clientOptions={{baseUrl: 'https://ops.test', fetcher}}>
        <Probe />
      </AppStore>,
    );
  });
  await act(async () => app.selectService('https://issuer.example.com'));
  await act(async () => app.signIn('operator', 'fixture'));
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://issuer.example.com/auth/operator/session',
  );
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('Bearer');
});

test('an unconfirmed legacy record blocks switching so another service never receives its token', async () => {
  await mount(disk().storage);
  jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockResolvedValue({operator_id: 1, env: 'issued', token: 'token-a'});
  jest
    .spyOn(ApiClient.prototype, 'postCard')
    .mockRejectedValue(new Error('fixture offline'));
  await act(async () => app.signIn('operator', 'fixture'));
  await act(async () =>
    app.postRegistryCard({
      short_id: 'aa',
      batch_id: 1,
      key_id: 1,
      ordinal: 0,
      installed_at: 1,
      installer: 'fixture',
      load_sha256: 'a'.repeat(64),
    }),
  );
  await act(async () => app.signOut());
  await expect(app.selectService('https://issuer.example.com')).rejects.toThrow(
    /pending records/,
  );
  expect(app.serviceUrl).toBe('https://ops.test');
});

test('redirected service replies cannot establish an operator session', async () => {
  const fetcher = jest.fn(
    async (_url: string, _options?: RequestInit) =>
      ({
        ok: true,
        status: 200,
        redirected: true,
        url: 'https://elsewhere.example.com/auth/operator/session',
        json: async () => ({
          kind: 'operator',
          operator_id: 1,
          env: 'issued',
          token: 'foreign-token',
        }),
      } as Response),
  );
  await act(async () => {
    tree = Renderer.create(
      <AppStore
        serviceStorage={disk().storage}
        clientOptions={{baseUrl: 'https://ops.test', fetcher}}>
        <Probe />
      </AppStore>,
    );
  });
  await act(async () => {
    await expect(app.signIn('operator', 'fixture')).rejects.toThrow(
      /redirected/,
    );
  });
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    credentials: 'omit',
  });
  expect(app.signedIn).toBe(false);
});

test('an old service retry callback cannot send its token through the new service outbox', async () => {
  await mount(disk().storage);
  const auth = jest.spyOn(ApiClient.prototype, 'operatorSession');
  auth.mockResolvedValue({operator_id: 1, env: 'issued', token: 'token-a'});
  await act(async () => app.signIn('operator', 'fixture'));
  const oldRetry = app.retryPending;
  await act(async () => app.signOut());
  await act(async () => app.selectService('https://issuer.example.com'));
  auth.mockResolvedValue({operator_id: 1, env: 'issued', token: 'token-b'});
  await act(async () => app.signIn('operator', 'fixture'));
  const post = jest
    .spyOn(ApiClient.prototype, 'postCard')
    .mockRejectedValue(new Error('fixture offline'));
  await act(async () =>
    app.postRegistryCard({
      short_id: 'bb',
      batch_id: 2,
      key_id: 2,
      ordinal: 0,
      installed_at: 1,
      installer: 'fixture',
      load_sha256: 'b'.repeat(64),
    }),
  );
  post.mockClear();
  await act(async () => oldRetry());
  expect(post).not.toHaveBeenCalled();
  expect(app.session?.token).toBe('token-b');
});

test('a late old-service 401 cannot expire the new service session after another retry confirmed the record', async () => {
  await mount(disk().storage);
  const auth = jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockResolvedValue({operator_id: 1, env: 'issued', token: 'token-a'});
  await act(async () => app.signIn('operator', 'fixture'));
  const post = jest
    .spyOn(ApiClient.prototype, 'postCard')
    .mockRejectedValue(new Error('fixture offline'));
  await act(async () =>
    app.postRegistryCard({
      short_id: 'aa',
      batch_id: 1,
      key_id: 1,
      ordinal: 0,
      installed_at: 1,
      installer: 'fixture',
      load_sha256: 'a'.repeat(64),
    }),
  );
  let reject!: (reason: Error) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = app.retryPending();
  });
  post.mockResolvedValue(undefined);
  await act(async () => app.retryPending());
  await act(async () => app.signOut());
  await act(async () => app.selectService('https://issuer.example.com'));
  auth.mockResolvedValue({operator_id: 1, env: 'issued', token: 'token-b'});
  await act(async () => app.signIn('operator', 'fixture'));
  const {ApiServiceError} = require('../src/api');
  await act(async () => {
    reject(new ApiServiceError('expired', 401));
    await pending;
  });
  expect(app.signedIn).toBe(true);
  expect(app.serviceUrl).toBe('https://issuer.example.com');
  expect(app.session?.token).toBe('token-b');
});
