import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {AppStore} from '../src/store';
import {useProvisioning} from '../src/ProvisioningStore';
import {CardStatusScreen} from '../src/screens/CardStatusScreen';
import type {ResetReview} from '../src/cardkit';
jest.mock('../src/ProvisioningStore', () => ({useProvisioning: jest.fn()}));
const card: ResetReview = {
  chipId: 'cplc-v1:4790d3213041093363205547',
  installationId:
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  unspent: 0,
  spent: 13,
  owner: true,
  pin: true,
  pinBlocked: false,
  tries: 3,
  locked: false,
  record: true,
  tag: true,
  sealed: true,
  mint: 'https://mint.test',
  recordDigest: 'ab'.repeat(32),
};
test('status reads are explicit; holder instructions and reset review do not start installation or mutate the card', async () => {
  const inspectStatus = jest.fn(),
    onInstall = jest.fn(),
    onReset = jest.fn();
  const flow = {
    status: 'ready',
    scopeMatches: true,
    busy: false,
    cardActive: false,
    notice: null,
    snapshot: {active: null, batch: null},
    resetState: null,
    cardReadout: null,
    inspectStatus,
    dismissCardReadout: jest.fn(),
  };
  jest
    .mocked(useProvisioning)
    .mockImplementation(
      () => flow as unknown as ReturnType<typeof useProvisioning>,
    );
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <AppStore>
        <CardStatusScreen
          onBack={() => {}}
          onInstall={onInstall}
          onReset={onReset}
        />
      </AppStore>,
    );
  });
  expect(inspectStatus).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByProps({testID: 'card-status-read'}).props.onPress();
  });
  expect(inspectStatus).toHaveBeenCalledTimes(1);
  Object.assign(flow, {
    cardReadout: {
      readout: {state: 'present', chipId: card.chipId, card},
      source: {can_reset: true, lookup: {status: 'found'}},
    },
  });
  await act(async () => {
    tree.update(
      <AppStore>
        <CardStatusScreen
          onBack={() => {}}
          onInstall={onInstall}
          onReset={onReset}
        />
      </AppStore>,
    );
  });
  expect(
    tree.root.findByProps({testID: 'card-status-title'}).props.children,
  ).toBe('Check earlier payments');
  await act(async () => {
    tree.root.findByProps({testID: 'card-status-action'}).props.onPress();
  });
  expect(onInstall).not.toHaveBeenCalled();
  expect(onReset).not.toHaveBeenCalled();
  await act(async () => {
    tree.root.findByProps({testID: 'card-status-reset'}).props.onPress();
  });
  expect(onReset).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.unmount();
  });
});
