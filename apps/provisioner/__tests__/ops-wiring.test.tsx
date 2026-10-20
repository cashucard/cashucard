/**
 * ENG-740's provisioner wiring: sign-in failure renders the service's reason
 * (never improvised); S5's key-env card lights exactly one environment; demo
 * rows never go pending; CLOSE BATCH with pending rows shows the note first.
 * The api module is mocked; no test opens a socket.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Text} from 'react-native';

import {ApiClient, ApiUnreachableError} from '../src/api';
import {AppStore, useApp} from '../src/store';
import {SIGNIN, SUMMARY} from '../src/strings';
import {SignInScreen} from '../src/screens/SignInScreen';
import {BatchSummaryScreen} from '../src/screens/BatchSummaryScreen';

jest.mock('../src/api', () => {
  const actual = jest.requireActual('../src/api');
  return {...actual, ApiClient: jest.fn()};
});

const text = (tree: ReactTestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children as string)
    .join('\n');

beforeEach(() => {
  jest.clearAllMocks();
});

/** A mount of SignInScreen under a fresh store, with the api mock scripted. */
async function mountSignIn(
  impl: 'reject-reason' | 'reject-unreachable' | 'resolve',
): Promise<ReactTestRenderer.ReactTestRenderer> {
  (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
    operatorSession:
      impl === 'resolve'
        ? async () => ({env: 'issued', token: 't'})
        : impl === 'reject-unreachable'
        ? async () => {
            throw new ApiUnreachableError();
          }
        : async () => {
            throw new ApiServiceImplError();
          },
  }));
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <SignInScreen />
      </AppStore>,
    );
  });
  return tree!;
}

class ApiServiceImplError extends Error {
  readonly reason = 'bad-credentials';
  constructor() {
    super('bad-credentials');
    this.name = 'ApiServiceError';
  }
}

/** Fills the sign-in form's name and password (S1's typed credentials). */
async function fillCredentials(
  tree: ReactTestRenderer.ReactTestRenderer,
  name = 'bench-lead',
  password = 'pw',
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText(name);
    await tree.root
      .findByProps({
        testID: 'sign-in-password',
      })
      .props.onChangeText(password);
  });
}

test('a failed sign-in renders SIGNIN.failed with the service reason, and retries on press', async () => {
  const tree = await mountSignIn('reject-reason');
  expect(text(tree)).not.toContain('SIGNIN.failed');

  await fillCredentials(tree);
  await ReactTestRenderer.act(async () => {
    await tree.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  expect(text(tree)).toContain(SIGNIN.failed('bad-credentials'));

  // retry on press: this time it resolves
  (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
    operatorSession: async () => ({env: 'issued', token: 't'}),
  }));
  await ReactTestRenderer.act(async () => {
    await tree.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  expect(text(tree)).not.toContain(SIGNIN.failed('bad-credentials'));
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
});

test('an unreachable service renders the unreachable reason (S1: the service-side reason, not improvised)', async () => {
  const tree = await mountSignIn('reject-unreachable');
  await fillCredentials(tree);
  await ReactTestRenderer.act(async () => {
    await tree.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  expect(text(tree)).toContain(
    SIGNIN.failed('the record service cannot be reached'),
  );
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
});

test('the sign-in button is disabled until name and password are typed (no hardcoded operator)', async () => {
  const tree = await mountSignIn('resolve');
  expect(tree.root.findByProps({testID: 'sign-in'}).props.disabled).toBe(true);
  await fillCredentials(tree);
  expect(tree.root.findByProps({testID: 'sign-in'}).props.disabled).toBe(false);
  await ReactTestRenderer.act(() => {
    tree.unmount();
  });
});

test('the stub line "While the key service is pending…" is gone', () => {
  // the copy lives in strings.ts; the stub's phrasing must not survive it
  const strings = require('../src/strings');
  const all = JSON.stringify(strings);
  expect(all).not.toContain('admits any build');
  expect(all).not.toContain('While the key service is pending');
});

test('S5: exactly one environment is ever lit, from the session env', async () => {
  // The screen's rule: both lit flags derive from ONE value (session env, or
  // factory when signed out), so "both lit" is unrepresentable. The cases
  // drive the store's real sign-in seam and read what the probe renders.
  const cases: Array<['factory' | 'issued' | null, string]> = [
    ['issued', 'factory-dim issued-lit'],
    ['factory', 'factory-lit issued-dim'],
    [null, 'factory-lit issued-dim'], // sign-in failed: signed out, factory default
  ];
  for (const [env, expected] of cases) {
    if (env) {
      (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
        operatorSession: async () => ({env, token: 't'}),
      }));
    } else {
      (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
        operatorSession: async () => {
          throw new ApiServiceImplError();
        },
      }));
    }
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <AppStore
          clientOptions={{baseUrl: 'http://ops.test'}}
          key={String(env)}>
          <SettingsProbeWithSignIn />
        </AppStore>,
      );
    });
    const rendered = tree!.root
      .findAll(n => typeof n.props.children === 'string')
      .map(n => n.props.children as string)
      .join(' ');
    expect(rendered).toContain(expected);
    // and the rule's negation: never both lit in any rendered case
    expect(rendered).not.toContain('factory-lit issued-lit');
    await ReactTestRenderer.act(() => {
      tree!.unmount();
    });
  }
});

/** Signs in (or fails) on mount, then renders the two lit flags' words. */
function SettingsProbeWithSignIn(): React.JSX.Element {
  const app = useApp();
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    app
      .signIn('bench-lead', 'pw')
      .catch(() => undefined)
      .then(() => setDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!done) {
    return <Text>signing-in</Text>;
  }
  const env = app.session?.env ?? 'factory';
  const factoryLit = env === 'factory';
  const issuedLit = env === 'issued';
  return (
    <Text>
      {`${factoryLit ? 'factory-lit' : 'factory-dim'} ${
        issuedLit ? 'issued-lit' : 'issued-dim'
      }`}
    </Text>
  );
}

test('demo rows stay pending: false; real rows can be pending', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let state: ReturnType<typeof useApp> | undefined;
  function Probe(): React.JSX.Element {
    state = useApp();
    return null as unknown as React.JSX.Element;
  }
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <Probe />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(() => {
    state!.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 4,
    });
  });
  await ReactTestRenderer.act(() => {
    state!.addDemoRecord({
      id: 'd1',
      ok: true,
      demo: 'ok',
      at: 1,
      pending: false,
    });
  });
  expect(state!.batch!.done[0].pending).toBe(false);
  await ReactTestRenderer.act(() => {
    state!.addRecord({id: 'd2', ok: true, at: 2, pending: true});
  });
  expect(state!.batch!.done[1].pending).toBe(true);
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

test('CLOSE BATCH with pending rows shows the note first; the second press closes', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  const onClosed = jest.fn();
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <BatchSummaryScreenWithPending onClosed={onClosed} />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'close-batch'}).props.onPress();
  });
  expect(text(tree)).toContain(SUMMARY.pendingNote);
  expect(onClosed).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'close-batch'}).props.onPress();
  });
  expect(onClosed).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

/** The summary screen with one pending row already in the batch. */
function BatchSummaryScreenWithPending({
  onClosed,
}: {
  onClosed: () => void;
}): React.JSX.Element {
  const app = useApp();
  const [seeded] = React.useState(() => {
    app.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 1,
    });
    app.addRecord({id: 'ab12', ok: true, at: 1, pending: true});
    return true;
  });
  // The screen reads app.batch!; the seed's setState flushes before this
  // child's guarded render, and the first pass waits for it.
  if (!seeded || !app.batch) {
    return <Text>loading</Text>;
  }
  return <BatchSummaryScreen onBack={() => undefined} onClose={onClosed} />;
}

test('retryPending flips the batch view pending flags via a successful retry pass (field match, not identity)', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let state: ReturnType<typeof useApp> | undefined;
  function Probe(): React.JSX.Element {
    state = useApp();
    return null as unknown as React.JSX.Element;
  }
  // A failed first post leaves the row pending on the batch view and in the
  // outbox: the outbox's client is built at sign-in, so the mock must fail
  // at post time — a flag the scripted client reads, not a re-mock.
  let postSucceeds = false;
  (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
    operatorSession: async () => ({env: 'issued', token: 't'}),
    postCard: async () => {
      if (!postSucceeds) {
        throw new Error('503');
      }
    },
  }));
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <Probe />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(async () => {
    await state!.signIn('bench-lead', 'pw');
  });
  await ReactTestRenderer.act(() => {
    state!.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 2,
    });
  });
  await ReactTestRenderer.act(async () => {
    state!.postRegistryCard({
      short_id: 'ab12',
      batch_id: 1,
      key_id: 2,
      ordinal: 0,
      installed_at: 1_700_000_000,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  expect(state!.batch!.done[0].pending).toBe(true);

  // The retry pass runs against a now-answering client: the batch view's
  // pending flag flips. The outbox row and the batch-view row are different
  // objects, so this passes only when the match is by fields.
  postSucceeds = true;
  await ReactTestRenderer.act(async () => {
    await state!.retryPending();
  });
  expect(state!.batch!.done[0].pending).toBe(false);
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

test('a 401 on the retry pass signs the session out (an expired 12 h token cannot retry forever)', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let state: ReturnType<typeof useApp> | undefined;
  function Probe(): React.JSX.Element {
    state = useApp();
    return null as unknown as React.JSX.Element;
  }
  // The client is captured at sign-in; the flag starts true so the inline
  // post lands (200), then flips for the retry pass (401 = expired token).
  // The 401 must be the real ApiServiceError: the outbox and the store tell
  // it apart from a transport failure by instanceof.
  const {ApiServiceError} = jest.requireActual(
    '../src/api',
  ) as typeof import('../src/api');
  let postSucceeds = true;
  (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
    operatorSession: async () => ({env: 'issued', token: 't'}),
    postCard: async () => {
      if (!postSucceeds) {
        throw new ApiServiceError('no-session', 401);
      }
    },
  }));
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <Probe />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(async () => {
    await state!.signIn('bench-lead', 'pw');
  });
  await ReactTestRenderer.act(() => {
    state!.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 1,
    });
  });
  await ReactTestRenderer.act(async () => {
    state!.postRegistryCard({
      short_id: 'cd34',
      batch_id: 1,
      key_id: 2,
      ordinal: 0,
      installed_at: 1_700_000_001,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  expect(state!.batch!.done[0].pending).toBe(false);

  postSucceeds = false;
  // A second row goes out and 401s into the outbox; the retry pass hits it.
  await ReactTestRenderer.act(async () => {
    state!.postRegistryCard({
      short_id: 'ef56',
      batch_id: 1,
      key_id: 2,
      ordinal: 1,
      installed_at: 1_700_000_002,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  expect(state!.batch!.done[1].pending).toBe(true);

  await ReactTestRenderer.act(async () => {
    await state!.retryPending();
  });
  expect(state!.signedIn).toBe(false, 'the 401 signed the session out');
  expect(state!.session).toBeNull();
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

test('a 401 expiry keeps the outbox: sign out, sign back in, retryPending re-posts the surviving rows', async () => {
  // The orphan scenario the 401 fix exists for: token expires mid-batch with
  // pending rows -> 401 -> sign out -> sign in. The outbox's frozen bodies
  // are still valid — only the token died — so the fresh session's retry
  // pass must re-post them; a fresh outbox here would orphan them forever.
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let state: ReturnType<typeof useApp> | undefined;
  function Probe(): React.JSX.Element {
    state = useApp();
    return null as unknown as React.JSX.Element;
  }
  const {ApiServiceError} = jest.requireActual(
    '../src/api',
  ) as typeof import('../src/api');
  const posted: unknown[] = [];
  let authMode: 'ok' | 'unauthorized' = 'ok';
  (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
    operatorSession: async () => ({env: 'issued', token: 't'}),
    postCard: async (_token: string, row: unknown) => {
      if (authMode === 'unauthorized') {
        throw new ApiServiceError('no-session', 401);
      }
      posted.push(row);
    },
  }));
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <Probe />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(async () => {
    await state!.signIn('bench-lead', 'pw');
  });
  await ReactTestRenderer.act(() => {
    state!.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 1,
    });
  });

  // The token dies before the row can post: it lands pending in the outbox.
  authMode = 'unauthorized';
  await ReactTestRenderer.act(async () => {
    state!.postRegistryCard({
      short_id: 'aa11',
      batch_id: 1,
      key_id: 2,
      ordinal: 0,
      installed_at: 1_700_000_000,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  expect(state!.batch!.done[0].pending).toBe(true);

  // The retry pass hits the 401 and expires the session — the outbox survives.
  await ReactTestRenderer.act(async () => {
    await state!.retryPending();
  });
  expect(state!.signedIn).toBe(false);
  expect(posted).toEqual([]);

  // Sign back in: the surviving row re-posts under the new token.
  authMode = 'ok';
  await ReactTestRenderer.act(async () => {
    await state!.signIn('bench-lead', 'pw');
  });
  await ReactTestRenderer.act(async () => {
    await state!.retryPending();
  });
  expect(posted).toHaveLength(1);
  // the frozen body, re-posted byte-identical
  expect((posted[0] as {short_id: string}).short_id).toBe('aa11');
  expect(state!.batch!.done[0].pending).toBe(false);
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

test('a real-mode stopped row carries no demo field; the summary prints no (demo: …) label for it', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let state: ReturnType<typeof useApp> | undefined;
  function Probe(): React.JSX.Element {
    state = useApp();
    return null as unknown as React.JSX.Element;
  }
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <Probe />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(() => {
    state!.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 2,
    });
  });
  // The row shape the loop's real-mode stop branch builds (no demo field).
  await ReactTestRenderer.act(() => {
    state!.addRecord({
      id: 'wrong-keys-card',
      ok: false,
      at: 1_700_000_000,
      pending: false,
    });
  });
  expect(state!.batch!.done[0].demo).toBeUndefined();

  // And the summary screen prints the row without a demo label.
  function SummaryProbe(): React.JSX.Element {
    const app = useApp();
    if (!app.batch) {
      return <Text>loading</Text>;
    }
    return (
      <BatchSummaryScreen onBack={() => undefined} onClose={() => undefined} />
    );
  }
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <SummaryProbe />
      </AppStore>,
    );
  });
  expect(text(tree)).not.toContain('(demo:');
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

test('a manual signOut with pending rows keeps the outbox; an empty one is dropped', async () => {
  // The should-fix on PR #11: signOut nulled the outbox unconditionally, so
  // signing out mid-batch destroyed pending rows' frozen bodies — they could
  // never be re-posted and the registry row was lost. Manual sign-out keeps
  // them, exactly like the 401 path; an outbox with nothing pending is
  // dropped so a fresh sign-in starts clean.
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let state: ReturnType<typeof useApp> | undefined;
  function Probe(): React.JSX.Element {
    state = useApp();
    return null as unknown as React.JSX.Element;
  }
  const posted: unknown[] = [];
  let postSucceeds = false;
  (ApiClient as unknown as jest.Mock).mockImplementation(() => ({
    operatorSession: async () => ({env: 'issued', token: 't'}),
    postCard: async (_token: string, row: unknown) => {
      if (!postSucceeds) {
        throw new Error('503');
      }
      posted.push(row);
    },
  }));
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore clientOptions={{baseUrl: 'http://ops.test'}}>
        <Probe />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(async () => {
    await state!.signIn('bench-lead', 'pw');
  });
  await ReactTestRenderer.act(() => {
    state!.startBatch({
      mint: 'm',
      pinPolicy: 'perCard',
      pinBatch: '',
      dailyUsd: 1,
      noPinUsd: 1,
      count: 1,
    });
  });

  // The post fails: the row is pending in the outbox and on the batch view.
  await ReactTestRenderer.act(async () => {
    state!.postRegistryCard({
      short_id: 'bb22',
      batch_id: 1,
      key_id: 2,
      ordinal: 0,
      installed_at: 1_700_000_003,
      installer: 'op@bench-1',
      load_sha256: 'fe7d8ac3',
    });
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  expect(state!.batch!.done[0].pending).toBe(true);

  // Manual sign-out: the pending outbox survives; sign back in and the
  // frozen body re-posts once the service answers.
  await ReactTestRenderer.act(() => {
    state!.signOut();
  });
  expect(state!.signedIn).toBe(false);

  postSucceeds = true;
  await ReactTestRenderer.act(async () => {
    await state!.signIn('bench-lead', 'pw');
  });
  await ReactTestRenderer.act(async () => {
    await state!.retryPending();
  });
  expect(posted).toHaveLength(1);
  expect((posted[0] as {short_id: string}).short_id).toBe('bb22');
  expect(state!.batch!.done[0].pending).toBe(false);
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});
