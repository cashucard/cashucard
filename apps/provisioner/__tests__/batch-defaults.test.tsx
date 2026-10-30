import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ApiClient} from '../src/api';
import {BatchSetupScreen} from '../src/screens/BatchSetupScreen';
import {useApp} from '../src/store';
import {readBatchDefaults, rememberBatchDefaults} from '../src/batchDefaults';
jest.mock('../src/store', () => ({useApp: jest.fn()}));
let tree: Renderer.ReactTestRenderer;
const actor = {
  service_origin: 'https://ops.test',
  operator_id: 1,
  key_env: 'issued' as const,
};
beforeEach(() => {
  jest.mocked(useApp).mockReturnValue({
    session: {operator_id: 1, env: 'issued', token: 'fixture'},
    serviceUrl: 'https://ops.test',
  } as unknown as ReturnType<typeof useApp>);
  jest
    .spyOn(ApiClient.prototype, 'mints')
    .mockResolvedValue(['https://mint-a.test', 'https://mint-b.test']);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});
async function mount() {
  await act(async () => {
    tree = Renderer.create(
      <BatchSetupScreen
        installationOnly
        onStart={() => {}}
        onSettings={() => {}}
        onStartAndRead={async () => true}
      />,
    );
  });
}
test('last approved mint/count are scoped to the exact service and operator and prefill the visible review', async () => {
  await rememberBatchDefaults(actor, {mint: 'https://mint-b.test', count: 4});
  expect(await readBatchDefaults({...actor, operator_id: 2})).toBeNull();
  expect(
    await readBatchDefaults({...actor, service_origin: 'https://other.test'}),
  ).toBeNull();
  await mount();
  expect(tree.root.findByProps({testID: 'batch-count'}).props.value).toBe('4');
  expect(
    tree.root.findByProps({testID: 'batch-inline-review'}).props.children,
  ).toContain('https://mint-b.test');
});
test('late remembered defaults cannot overwrite edits made while loading the service mint list', async () => {
  let finish!: (v: string) => void;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await mount();
  await act(async () => {
    tree.root
      .findByProps({testID: 'mint-custom-input'})
      .props.onChangeText('https://manual.test');
    tree.root.findByProps({testID: 'batch-count'}).props.onChangeText('9');
  });
  await act(async () =>
    finish(JSON.stringify({mint: 'https://mint-b.test', count: 4})),
  );
  expect(tree.root.findByProps({testID: 'batch-count'}).props.value).toBe('9');
  expect(
    tree.root.findByProps({testID: 'batch-inline-review'}).props.children,
  ).toContain('https://manual.test');
});
test('a remembered mint removed from the service list requires an explicit new choice', async () => {
  await rememberBatchDefaults(actor, {mint: 'https://removed.test', count: 3});
  await mount();
  expect(tree.root.findByProps({testID: 'start-batch'}).props.disabled).toBe(
    true,
  );
  expect(JSON.stringify(tree.toJSON())).toContain(
    'previous choice is no longer listed',
  );
});
