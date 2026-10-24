import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import App from '../App';
import {ApiClient} from '../src/api';
import {useProvisioning} from '../src/ProvisioningStore';
jest.mock('../src/ProvisioningStore', () => ({
  ProvisioningProvider: ({children}: {children: React.ReactNode}) => children,
  useProvisioning: jest.fn(),
}));
const trees: Renderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => trees.splice(0).forEach(t => t.unmount()));
  jest.restoreAllMocks();
});
function flow(active = false, foreign = false) {
  return {
    status: 'ready',
    scopeMatches: !foreign,
    busy: false,
    hardwareValidated: true,
    snapshot: {
      device_id: 'device',
      batch: {
        scope: {operator_id: 1, service_origin: 'https://ops.test'},
        batch_id: 7,
        next_ordinal: 0,
        request: {count: 2},
      },
      active: active ? {attempt_id: 'id', journal: null} : null,
      history: [],
    },
    resetState: null,
    cancel: jest.fn(),
    end: jest.fn(),
    close: jest.fn(),
    recover: jest.fn(),
  } as unknown as ReturnType<typeof useProvisioning>;
}
async function signedIn() {
  jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockResolvedValue({operator_id: 1, env: 'issued', token: 'test-token'});
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(<App />);
  });
  trees.push(tree);
  await act(async () => {
    tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('operator');
    tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('fixture');
  });
  await act(async () => {
    await tree.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  return tree;
}
test('Stop for now returns to Cards; Settings Back stays there instead of reopening the saved batch', async () => {
  const state = flow();
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'home-resume'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'work-stop-for-now'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-resume'})).toBeDefined();
  expect(state.cancel).toHaveBeenCalledTimes(1);
  await act(async () =>
    tree.root.findByProps({testID: 'settings'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-resume'})).toBeDefined();
  expect(tree.root.findAllByProps({testID: 'work-stop-for-now'})).toHaveLength(
    0,
  );
  expect(state.end).not.toHaveBeenCalled();
});
test('ending a batch is visible on Cards and requires confirmation; unresolved attempts cannot be ended', async () => {
  const state = flow();
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'home-end'}).props.onPress(),
  );
  expect(state.end).not.toHaveBeenCalled();
  await act(async () =>
    tree.root.findByProps({testID: 'home-end-confirm'}).props.onPress(),
  );
  expect(state.end).toHaveBeenCalledTimes(1);
  jest.mocked(useProvisioning).mockReturnValue(flow(true));
  await act(async () => tree.update(<App />));
  expect(tree.root.findAllByProps({testID: 'home-end'})).toHaveLength(0);
  expect(tree.root.findByProps({testID: 'home-resume'})).toBeDefined();
});
test('foreign work has an immediate account-switch exit and never exposes a new batch action', async () => {
  jest.mocked(useProvisioning).mockReturnValue(flow(false, true));
  const tree = await signedIn();
  expect(tree.root.findAllByProps({testID: 'home-new'})).toHaveLength(0);
  await act(async () =>
    tree.root.findByProps({testID: 'home-switch-account'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'sign-in'})).toBeDefined();
});

test('canceling new-batch setup returns home without creating or ending anything', async () => {
  const state = {
    ...flow(),
    snapshot: {batch: null, active: null, history: []},
  } as unknown as ReturnType<typeof useProvisioning>;
  jest.mocked(useProvisioning).mockReturnValue(state);
  jest
    .spyOn(ApiClient.prototype, 'mints')
    .mockResolvedValue(['https://mint.test']);
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'home-new'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'cancel-batch-setup'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-new'})).toBeDefined();
  expect(state.end).not.toHaveBeenCalled();
});
