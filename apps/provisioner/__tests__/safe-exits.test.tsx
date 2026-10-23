import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {BackHandler} from 'react-native';
import {Screen} from '../src/ui';
import {SignInScreen} from '../src/screens/SignInScreen';
import {AppStore, useApp} from '../src/store';
import {ApiClient} from '../src/api';
import {useProvisioning} from '../src/ProvisioningStore';
import {ProvisioningScreen} from '../src/screens/ProvisioningScreen';
jest.mock('../src/ProvisioningStore', () => ({useProvisioning: jest.fn()}));
const trees: Renderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(tree => tree.unmount()));
  jest.restoreAllMocks();
});

test('saved reset has an explicit exit to Settings without running or deleting it', async () => {
  const onSettings = jest.fn(),
    onReset = jest.fn();
  const saved = {journal: {stage: 'reviewed'}};
  jest.mocked(useProvisioning).mockReturnValue({
    status: 'ready',
    scopeMatches: true,
    busy: false,
    cancel: jest.fn(),
    cardActive: false,
    snapshot: {batch: null},
    resetState: saved,
  } as unknown as ReturnType<typeof useProvisioning>);
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <ProvisioningScreen onSettings={onSettings} onReset={onReset} />
      </AppStore>,
    );
  });
  trees.push(tree);
  await act(async () =>
    tree.root.findByProps({testID: 'reset-stop-for-now'}).props.onPress(),
  );
  expect(onSettings).toHaveBeenCalledTimes(1);
  expect(onReset).not.toHaveBeenCalled();
  expect(saved.journal.stage).toBe('reviewed');
});

test('hardware Back stops active work first and returns normally after it settles', async () => {
  let back!: () => boolean | null | undefined;
  const remove = jest.fn(),
    stop = jest.fn(),
    leave = jest.fn();
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      back = handler;
      return {remove};
    });
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <Screen title="Card work" onBack={leave} onStop={stop}>
        {null}
      </Screen>,
    );
  });
  trees.push(tree);
  expect(back()).toBe(true);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(leave).not.toHaveBeenCalled();
  await act(async () =>
    tree.update(
      <Screen title="Card work" onBack={leave}>
        {null}
      </Screen>,
    ),
  );
  expect(remove).toHaveBeenCalled();
  expect(back()).toBe(true);
  expect(leave).toHaveBeenCalledTimes(1);
});

test('a canceled sign-in cannot accept a late success from a transport that ignores abort', async () => {
  let app!: ReturnType<typeof useApp>;
  function Probe() {
    app = useApp();
    return null;
  }
  const client = new ApiClient({baseUrl: 'https://ops.test'});
  let finish!: (value: {
    operator_id: number;
    env: 'issued';
    token: string;
  }) => void;
  jest.spyOn(client, 'operatorSession').mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <Probe />
      </AppStore>,
    );
  });
  trees.push(tree);
  const controller = new AbortController();
  let pending!: Promise<void>;
  await act(async () => {
    pending = app.signIn('operator', 'public-test-fixture', {
      client,
      signal: controller.signal,
    });
  });
  controller.abort();
  let result!: unknown;
  const observed = pending.catch(error => {
    result = error;
  });
  await act(async () => {
    finish({operator_id: 1, env: 'issued', token: 'public-test-token'});
    await observed;
  });
  expect(result).toMatchObject({name: 'ApiCancelledError'});
  expect(app.signedIn).toBe(false);
  expect(app.session).toBeNull();
});

test('the sign-in Stop action clears the password and ignores a late successful login', async () => {
  let app!: ReturnType<typeof useApp>;
  function Probe() {
    app = useApp();
    return null;
  }
  let finish!: (value: {
    operator_id: number;
    env: 'issued';
    token: string;
  }) => void;
  jest.spyOn(ApiClient.prototype, 'operatorSession').mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <SignInScreen />
        <Probe />
      </AppStore>,
    );
  });
  trees.push(tree);
  await act(async () => {
    tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('operator');
    tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('public-test-fixture');
  });
  let pending!: Promise<void>;
  await act(async () => {
    pending = tree.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  await act(async () =>
    tree.root.findByProps({testID: 'screen-stop'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'sign-in-password'}).props.value).toBe(
    '',
  );
  expect(tree.root.findAllByProps({testID: 'sign-in-failed'})).toHaveLength(0);
  await act(async () => {
    finish({operator_id: 1, env: 'issued', token: 'public-test-token'});
    await pending;
  });
  expect(app.signedIn).toBe(false);
});
