/**
 * The mint picker's discovered mints and write-in gate (D180): the service's
 * defaults come first, a discovered mint shows its review count and name, a
 * failed mint_info leaves the plain grid, and a written-in mint is probed
 * before the batch is created.
 */
import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {ApiClient, ApiUnreachableError} from '../src/api';
import {BatchSetupScreen} from '../src/screens/BatchSetupScreen';
import {SETUP} from '../src/strings';
import {useApp} from '../src/store';
jest.mock('../src/store', () => ({useApp: jest.fn()}));

let tree: Renderer.ReactTestRenderer;
const DEFAULTS = ['https://default-a.test', 'https://default-b.test'];
const FOUND = ['https://found-3.test', 'https://found-1.test'];

beforeEach(() => {
  jest.mocked(useApp).mockReturnValue({
    session: {operator_id: 1, env: 'issued', token: 'fixture'},
    serviceUrl: 'https://ops.test',
  } as unknown as ReturnType<typeof useApp>);
  jest
    .spyOn(ApiClient.prototype, 'mints')
    .mockResolvedValue([...DEFAULTS, ...FOUND]);
  jest.spyOn(ApiClient.prototype, 'mintInfo').mockResolvedValue({
    'https://found-3.test': {name: 'Found Mint', reviews: 3},
    'https://found-1.test': {reviews: 1},
  });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

async function mount(
  props: Partial<React.ComponentProps<typeof BatchSetupScreen>> = {},
) {
  await act(async () => {
    tree = Renderer.create(
      <BatchSetupScreen
        installationOnly
        onStart={() => {}}
        onSettings={() => {}}
        {...props}
      />,
    );
  });
}
const byId = (id: string) => tree.root.findByProps({testID: id});
const cellOrder = () =>
  tree.root
    .findAll(n => typeof n.props.testID === 'string' && n.type !== Text)
    .map(n => n.props.testID as string)
    .filter(id => /^mint-https/.test(id))
    .filter((id, i, all) => all.indexOf(id) === i);
const writeIn = async (url: string) =>
  act(async () => byId('mint-custom-input').props.onChangeText(url));
const press = async (id: string) => act(async () => byId(id).props.onPress());

test('defaults come first, then discovered mints with their review line', async () => {
  await mount();
  expect(cellOrder()).toEqual([...DEFAULTS, ...FOUND].map(m => `mint-${m}`));
  const line = (m: string) =>
    tree.root.findByProps({testID: `mint-reviews-${m}`}).props.children;
  expect(line('https://found-3.test')).toBe('3 reviews · Found Mint');
  expect(line('https://found-1.test')).toBe('1 review');
  for (const m of DEFAULTS) {
    expect(tree.root.findAllByProps({testID: `mint-reviews-${m}`})).toEqual([]);
  }
});

test('a failed mint_info still renders the plain grid', async () => {
  jest
    .spyOn(ApiClient.prototype, 'mintInfo')
    .mockRejectedValue(new ApiUnreachableError('offline'));
  await mount();
  expect(cellOrder()).toEqual([...DEFAULTS, ...FOUND].map(m => `mint-${m}`));
  expect(
    tree.root.findAll(
      n =>
        typeof n.props.testID === 'string' &&
        n.props.testID.startsWith('mint-reviews-'),
    ),
  ).toEqual([]);
});

test('a listed mint is not probed', async () => {
  const probe = jest.spyOn(ApiClient.prototype, 'probeMint');
  await mount();
  await press(`mint-${FOUND[0]}`);
  await press('start-batch');
  expect(probe).not.toHaveBeenCalled();
  expect(byId('confirm-start-batch')).toBeTruthy();
});

test('a written-in mint that passes the probe goes on to the batch', async () => {
  const probe = jest
    .spyOn(ApiClient.prototype, 'probeMint')
    .mockResolvedValue({ok: true, name: 'Private'});
  const create = jest.fn(async () => true);
  await mount({onStartAndRead: undefined, onCreate: create});
  await writeIn('https://private.test');
  await press('start-batch');
  expect(probe).toHaveBeenCalledWith('fixture', 'https://private.test');
  await press('confirm-start-batch');
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({mint: 'https://private.test'}),
  );
});

test('a written-in mint that fails the probe shows the note and creates nothing', async () => {
  jest
    .spyOn(ApiClient.prototype, 'probeMint')
    .mockResolvedValue({ok: false, reason: 'keysets: no active sat'});
  const create = jest.fn(async () => true);
  await mount({installationOnly: false, onCreate: create});
  await writeIn('https://usd-only.test');
  await press('start-batch');
  expect(byId('mint-probe-note').props.children).toBe(SETUP.mintProbeFailed);
  expect(tree.root.findAllByProps({testID: 'retry-mint-probe'})).toEqual([]);
  expect(create).not.toHaveBeenCalled();
  // Choosing a listed mint clears the note and needs no probe.
  await press(`mint-${DEFAULTS[0]}`);
  expect(tree.root.findAllByProps({testID: 'mint-probe-note'})).toEqual([]);
  await press('start-batch');
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({mint: DEFAULTS[0]}),
  );
});

test('a probe that cannot reach the service blocks, and the retry runs it again', async () => {
  const probe = jest
    .spyOn(ApiClient.prototype, 'probeMint')
    .mockRejectedValueOnce(new ApiUnreachableError('offline'))
    .mockResolvedValue({ok: true});
  const create = jest.fn(async () => true);
  await mount({installationOnly: false, onCreate: create});
  await writeIn('https://private.test');
  await press('start-batch');
  expect(byId('mint-probe-note').props.children).toBe(
    SETUP.mintProbeUnreachable,
  );
  expect(create).not.toHaveBeenCalled();
  await press('retry-mint-probe');
  expect(probe).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({mint: 'https://private.test'}),
  );
  expect(tree.root.findAllByProps({testID: 'mint-probe-note'})).toEqual([]);
});

test('the start button is disabled while the probe runs', async () => {
  let finish!: (v: {ok: true}) => void;
  jest.spyOn(ApiClient.prototype, 'probeMint').mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  await mount({installationOnly: false, onCreate: async () => true});
  await writeIn('https://slow.test');
  act(() => {
    byId('start-batch').props.onPress();
  });
  expect(byId('start-batch').props.disabled).toBe(true);
  expect(byId('start-batch').props.title).toBe(SETUP.checkingMint);
  expect(byId('mint-custom-input').props.editable).toBe(false);
  await act(async () => finish({ok: true}));
});
