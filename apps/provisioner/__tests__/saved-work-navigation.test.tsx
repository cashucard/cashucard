import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import App from '../App';
import {ApiClient} from '../src/api';
import {DEFAULT_SERVICE_URL} from '../src/store';
import {opsDashboardUrl} from '../src/LegalLinks';
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
        request: {count: 2, mint_url: 'https://mint.test'},
      },
      active: active ? {attempt_id: 'id', journal: null} : null,
      history: [],
    },
    resetState: null,
    resetReview: null,
    cardReadout: null,
    dismissCardReadout: jest.fn(),
    dismissResetReview: jest.fn(),
    inspectStatus: jest.fn(),
    inspectReset: jest.fn(),
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

function idle() {
  const state = flow();
  return {...state, snapshot: {...state.snapshot!, batch: null}};
}

test('Cards names the signed-in operator and service and offers everyday tools without starting card work', async () => {
  const state = idle();
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  expect(tree.root.findByProps({testID: 'home-operator'}).props.children).toBe(
    'operator',
  );
  expect(tree.root.findByProps({testID: 'home-service'}).props.children).toBe(
    opsDashboardUrl(DEFAULT_SERVICE_URL),
  );
  expect(tree.root.findByProps({testID: 'home-new'})).toBeDefined();
  expect(tree.root.findByProps({testID: 'home-check'}).props.disabled).toBe(
    false,
  );
  expect(tree.root.findByProps({testID: 'home-reset'}).props.disabled).toBe(
    false,
  );
  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).not.toContain('test-token');
  expect(rendered).not.toContain('fixture');
  expect(state.inspectStatus).not.toHaveBeenCalled();
  expect(state.inspectReset).not.toHaveBeenCalled();
});

test.each([
  ['check', 'card-status-read', 'card-status-entry'],
  ['reset', 'reset-inspect', 'reset-entry'],
])(
  '%s opens directly from Cards and returns to its launch screen',
  async (tool, actionId, settingsId) => {
    const state = idle();
    jest.mocked(useProvisioning).mockReturnValue(state);
    const tree = await signedIn();
    await act(async () =>
      tree.root.findByProps({testID: `home-${tool}`}).props.onPress(),
    );
    expect(tree.root.findByProps({testID: actionId})).toBeDefined();
    if (tool === 'reset') {
      expect(tree.root.findByProps({testID: 'reset-leave'}).props.title).toBe(
        'BACK TO CARDS',
      );
    }
    await act(async () =>
      tree.root
        .findByProps({testID: tool === 'reset' ? 'reset-leave' : 'back'})
        .props.onPress(),
    );
    expect(tree.root.findByProps({testID: 'home-new'})).toBeDefined();
    await act(async () =>
      tree.root.findByProps({testID: 'settings'}).props.onPress(),
    );
    expect(tree.root.findAllByProps({testID: settingsId})).toHaveLength(0);
    expect(tree.root.findByProps({testID: 'identity-entry'})).toBeDefined();
    await act(async () =>
      tree.root.findByProps({testID: 'back'}).props.onPress(),
    );
    expect(tree.root.findByProps({testID: `home-${tool}`})).toBeDefined();
    expect(state.inspectStatus).not.toHaveBeenCalled();
    expect(state.inspectReset).not.toHaveBeenCalled();
  },
);

test('a saved batch stays visible while a read-only check is available and a competing reset is disabled', async () => {
  const state = flow(true);
  const before = JSON.stringify(state.snapshot);
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  expect(JSON.stringify(tree.toJSON())).toContain('https://mint.test');
  expect(tree.root.findByProps({testID: 'home-reset'}).props.disabled).toBe(
    true,
  );
  expect(tree.root.findByProps({testID: 'home-check'}).props.disabled).toBe(
    false,
  );
  await act(async () =>
    tree.root.findByProps({testID: 'home-check'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-resume'})).toBeDefined();
  expect(JSON.stringify(state.snapshot)).toBe(before);
  expect(state.end).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
  expect(state.recover).not.toHaveBeenCalled();
});

test.each(['busy', 'foreign', 'loading', 'blocked'] as const)(
  'Cards keeps tool entry disabled when %s',
  async reason => {
    const state = {
      ...idle(),
      busy: reason === 'busy',
      scopeMatches: reason !== 'foreign',
      status: reason === 'loading' || reason === 'blocked' ? reason : 'ready',
    } as ReturnType<typeof useProvisioning>;
    jest.mocked(useProvisioning).mockReturnValue(state);
    const tree = await signedIn();
    expect(tree.root.findByProps({testID: 'home-check'}).props.disabled).toBe(
      true,
    );
    expect(tree.root.findByProps({testID: 'home-reset'}).props.disabled).toBe(
      true,
    );
    expect(state.inspectStatus).not.toHaveBeenCalled();
    expect(state.inspectReset).not.toHaveBeenCalled();
  },
);

test('installation-disabled builds still allow card checks while reset stays disabled', async () => {
  const state = {...idle(), hardwareValidated: false};
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  expect(tree.root.findByProps({testID: 'home-new'}).props.disabled).toBe(true);
  expect(tree.root.findByProps({testID: 'home-check'}).props.disabled).toBe(
    false,
  );
  expect(tree.root.findByProps({testID: 'home-reset'}).props.disabled).toBe(
    true,
  );
});

test('a pending reset remains the resume action and prevents a second reset', async () => {
  const state = {
    ...idle(),
    resetState: {journal: {stage: 'authorized', chip_id: 'cplc-v1:fixture'}},
  } as unknown as ReturnType<typeof useProvisioning>;
  const before = JSON.stringify(state.resetState);
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  expect(tree.root.findByProps({testID: 'home-resume'})).toBeDefined();
  expect(tree.root.findAllByProps({testID: 'home-new'})).toHaveLength(0);
  expect(tree.root.findByProps({testID: 'home-reset'}).props.disabled).toBe(
    true,
  );
  expect(JSON.stringify(state.resetState)).toBe(before);
});

test('card check to reset returns through card check and then Cards, without starting NFC', async () => {
  const state = {
    ...idle(),
    cardReadout: {
      readout: {
        state: 'present',
        chipId: 'cplc-v1:fixture',
        card: {
          chipId: 'cplc-v1:fixture',
          installationId: '02' + 'ab'.repeat(32),
          unspent: 0,
          spent: 0,
          owner: false,
          pin: false,
          pinBlocked: false,
          tries: 3,
          locked: false,
          record: false,
          tag: true,
          sealed: false,
          mint: '',
          recordDigest: 'ab'.repeat(32),
        },
      },
      source: {can_reset: true, lookup: {status: 'found'}},
    },
  } as ReturnType<typeof useProvisioning>;
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'home-check'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'card-status-reset'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'reset-leave'}).props.title).toBe(
    'BACK TO CARD CHECK',
  );
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'card-status-read'})).toBeDefined();
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-new'})).toBeDefined();
  expect(state.inspectStatus).not.toHaveBeenCalled();
  expect(state.inspectReset).not.toHaveBeenCalled();
});

test('a card check opened during batch setup returns to that form', async () => {
  const state = idle();
  jest.mocked(useProvisioning).mockReturnValue(state);
  jest
    .spyOn(ApiClient.prototype, 'mints')
    .mockResolvedValue(['https://mint.test']);
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'home-new'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'open-card-status'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'cancel-batch-setup'})).toBeDefined();
  expect(state.inspectStatus).not.toHaveBeenCalled();
  expect(state.end).not.toHaveBeenCalled();
});

test('switching accounts replaces the displayed operator and resets tool navigation', async () => {
  jest.mocked(useProvisioning).mockReturnValue(flow(false, true));
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'home-switch-account'}).props.onPress(),
  );
  jest.mocked(useProvisioning).mockReturnValue(idle());
  jest
    .mocked(ApiClient.prototype.operatorSession)
    .mockResolvedValue({operator_id: 2, env: 'issued', token: 'second-token'});
  await act(async () => {
    tree.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('other-operator');
    tree.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('fixture');
  });
  await act(async () =>
    tree.root.findByProps({testID: 'sign-in'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-operator'}).props.children).toBe(
    'other-operator',
  );
  await act(async () =>
    tree.root.findByProps({testID: 'home-check'}).props.onPress(),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-new'})).toBeDefined();
});

test('Settings retains identity diagnostics and their Back path without duplicating daily card tools', async () => {
  const state = idle();
  jest.mocked(useProvisioning).mockReturnValue(state);
  const tree = await signedIn();
  await act(async () =>
    tree.root.findByProps({testID: 'settings'}).props.onPress(),
  );
  for (const id of ['card-status-entry', 'reset-entry']) {
    expect(tree.root.findAllByProps({testID: id})).toHaveLength(0);
  }
  await act(async () =>
    tree.root.findByProps({testID: 'identity-entry'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'identity-read'})).toBeDefined();
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'identity-entry'})).toBeDefined();
  await act(async () =>
    tree.root.findByProps({testID: 'back'}).props.onPress(),
  );
  expect(tree.root.findByProps({testID: 'home-new'})).toBeDefined();
  expect(state.inspectStatus).not.toHaveBeenCalled();
  expect(state.inspectReset).not.toHaveBeenCalled();
});
