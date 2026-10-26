import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {Linking, Modal, StyleSheet, Text} from 'react-native';
import NfcManager from 'react-native-nfc-manager';
import {InfoButton} from '../src/ui';
import {CardsHomeScreen} from '../src/screens/CardsHomeScreen';
import {SignInScreen} from '../src/screens/SignInScreen';
import {BatchSetupScreen} from '../src/screens/BatchSetupScreen';
import {ProvisioningScreen} from '../src/screens/ProvisioningScreen';
import {CardStatusScreen} from '../src/screens/CardStatusScreen';
import {CardIdentityScreen} from '../src/screens/CardIdentityScreen';
import {ResetCardScreen} from '../src/screens/ResetCardScreen';
import {useApp} from '../src/store';
import {useProvisioning} from '../src/ProvisioningStore';
jest.mock('../src/store', () => ({useApp: jest.fn()}));
jest.mock('../src/ProvisioningStore', () => ({useProvisioning: jest.fn()}));
const noop = () => {};
let tree: Renderer.ReactTestRenderer;
let inspect: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  inspect = jest.fn();
  jest.mocked(useApp).mockReturnValue({
    operatorName: 'dread',
    session: null,
    serviceUrl: 'https://cashu-card-ops.old-cell-30e7.workers.dev',
    theme: 'dark',
    signOut: jest.fn(),
    setTheme: jest.fn(),
  } as unknown as ReturnType<typeof useApp>);
  jest.mocked(useProvisioning).mockReturnValue({
    status: 'ready',
    scopeMatches: true,
    busy: false,
    hardwareValidated: true,
    snapshot: {batch: null, active: null, history: []},
    resetState: null,
    resetReview: null,
    cardReadout: null,
    inspectStatus: inspect,
    inspectReset: inspect,
    dismissResetReview: jest.fn(),
    dismissCardReadout: jest.fn(),
  } as unknown as ReturnType<typeof useProvisioning>);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});
const action = (id: string) =>
  tree.root
    .findAllByProps({testID: id})
    .find(
      node =>
        node.props.accessibilityRole === 'button' ||
        node.props.accessibilityRole === 'link',
    )!;
const text = () => JSON.stringify(tree.toJSON());
const render = async (node: React.ReactElement) => {
  await act(async () => {
    tree = Renderer.create(node);
  });
};
test('info uses a labeled 44-point target and closes by button or system Back', async () => {
  await render(
    <InfoButton title="Batch setup" testID="help">
      Optional explanation
    </InfoButton>,
  );
  const button = () => action('help');
  expect(button().props.accessibilityLabel).toBe('About Batch setup');
  expect(StyleSheet.flatten(button().props.style)).toMatchObject({
    minWidth: 44,
    minHeight: 44,
  });
  expect(text()).not.toContain('Optional explanation');
  await act(async () => button().props.onPress());
  expect(text()).toContain('Optional explanation');
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(text()).not.toContain('Optional explanation');
  await act(async () => button().props.onPress());
  await act(async () =>
    tree.root.findByProps({testID: 'help-close'}).props.onPress(),
  );
  expect(text()).not.toContain('Optional explanation');
});
test('Cards labels the login and links the dashboard while connection details retain the true API origin', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(
    <CardsHomeScreen
      onInstall={noop}
      onCheck={noop}
      onReset={noop}
      onSettings={noop}
    />,
  );
  expect(text()).toContain('Signed in as');
  expect(text()).toContain('dread');
  expect(
    tree.root.findByProps({testID: 'home-settings'}).props.accessibilityLabel,
  ).toContain('Signed in as dread');
  expect(text()).toContain('https://ops.cashucard.org');
  expect(text()).not.toContain('cashu-card-ops.old-cell-30e7.workers.dev');
  expect(text()).not.toContain('Install card software here');
  expect(open).not.toHaveBeenCalled();
  await act(async () => action('home-dashboard').props.onPress());
  expect(open).toHaveBeenCalledWith('https://ops.cashucard.org');
  await act(async () => action('home-account-help').props.onPress());
  expect(text()).toContain('https://cashu-card-ops.old-cell-30e7.workers.dev');
  expect(inspect).not.toHaveBeenCalled();
});
test('batch review keeps the key-assignment consequence visible and help cannot create the batch', async () => {
  const create = jest.fn();
  await render(
    <BatchSetupScreen
      installationOnly
      onCreate={create}
      onStart={noop}
      onSettings={noop}
    />,
  );
  expect(
    tree.root.findByProps({testID: 'setup-scroll'}).props
      .keyboardShouldPersistTaps,
  ).toBe('handled');
  await act(async () =>
    tree.root
      .findByProps({testID: 'mint-custom-input'})
      .props.onChangeText('https://mint.test'),
  );
  await act(async () =>
    tree.root.findByProps({testID: 'start-batch'}).props.onPress(),
  );
  expect(text()).toContain('Creating this batch assigns manager keys');
  expect(text()).not.toContain('Holders configure each card');
  await act(async () => action('setup-review-help').props.onPress());
  expect(text()).toContain('Holders configure each card');
  await act(async () => tree.root.findByType(Modal).props.onRequestClose());
  expect(
    tree.root.findByProps({testID: 'confirm-start-batch'}).props.disabled,
  ).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

const cases = [
  [
    'Cards',
    'home-batch-help',
    'Card holders finish ownership',
    () => (
      <CardsHomeScreen
        onInstall={noop}
        onCheck={noop}
        onReset={noop}
        onSettings={noop}
      />
    ),
  ],
  [
    'Sign-in',
    'sign-in-help',
    'Use the operator account',
    () => <SignInScreen />,
  ],
  [
    'Batch setup',
    'setup-mint-help',
    'The mint reference is',
    () => (
      <BatchSetupScreen installationOnly onStart={noop} onSettings={noop} />
    ),
  ],
  [
    'Installation',
    'installation-help',
    'Set up ownership and a PIN',
    () => <ProvisioningScreen onHome={noop} onSettings={noop} />,
  ],
  [
    'Card status',
    'card-status-help',
    'Reads public card identity',
    () => <CardStatusScreen onBack={noop} onInstall={noop} onReset={noop} />,
  ],
  [
    'Card identity',
    'identity-help',
    'CPLC is a public chip identifier',
    () => <CardIdentityScreen onBack={noop} />,
  ],
  [
    'Reset',
    'reset-help',
    'Reset removes',
    () => <ResetCardScreen onBack={noop} onInstall={noop} />,
  ],
] as const;
test.each(cases)(
  '%s keeps routine explanations behind a tap without starting card work',
  async (name, id, explanation, screen) => {
    if (name === 'Installation') {
      const flow = useProvisioning();
      jest.mocked(useProvisioning).mockReturnValue({
        ...flow,
        snapshot: {
          ...flow.snapshot!,
          batch: {
            batch_id: 7,
            next_ordinal: 0,
            request: {count: 1, mint_url: 'https://mint.test'},
          },
        },
      } as unknown as ReturnType<typeof useProvisioning>);
    }
    await render(screen());
    expect(text()).not.toContain(explanation);
    await act(async () => action(id).props.onPress());
    expect(text()).toContain(explanation);
    expect(inspect).not.toHaveBeenCalled();
    expect(NfcManager.requestTechnology).not.toHaveBeenCalled();
  },
);

test.each([
  'https://ops.another-issuer.com',
  'https://another-issuer.workers.dev',
])(
  'a build for %s links that service’s dashboard and preserves its API connection',
  async origin => {
    jest.mocked(useApp).mockReturnValue({...useApp(), serviceUrl: origin});
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(
      <CardsHomeScreen
        onInstall={noop}
        onCheck={noop}
        onReset={noop}
        onSettings={noop}
      />,
    );
    expect(text()).toContain(origin);
    expect(text()).not.toContain('https://ops.cashucard.org');
    await act(async () => action('home-dashboard').props.onPress());
    expect(open).toHaveBeenCalledWith(origin);
    expect(useApp().serviceUrl).toBe(origin);
    expect(inspect).not.toHaveBeenCalled();
  },
);

test('leaving a screen after dismissing help cancels its pending focus callback', async () => {
  jest.spyOn(global, 'requestAnimationFrame').mockReturnValue(47);
  const cancel = jest
    .spyOn(global, 'cancelAnimationFrame')
    .mockImplementation(() => {});
  await render(
    <InfoButton title="Batch setup" testID="focus-help">
      Explanation
    </InfoButton>,
  );
  await act(async () => action('focus-help').props.onPress());
  await act(async () =>
    tree.root.findByProps({testID: 'focus-help-close'}).props.onPress(),
  );
  await act(async () => tree.unmount());
  expect(cancel).toHaveBeenCalledWith(47);
});

test('service choices expose the actual API address when the dashboard uses an alias', async () => {
  const {
    ServiceSelectorScreen,
  } = require('../src/screens/ServiceSelectorScreen');
  const origin = 'https://cashu-card-ops.old-cell-30e7.workers.dev';
  jest.mocked(useApp).mockReturnValue({
    ...useApp(),
    serviceUrl: origin,
    serviceProfiles: [origin],
    serviceStatus: 'ready',
  });
  await render(<ServiceSelectorScreen onDone={noop} />);
  const row = tree.root.findByProps({testID: `service-choice-${origin}`});
  const words = row
    .findAllByType(Text)
    .map(node => node.props.children)
    .join(' ');
  expect(words).toContain('https://ops.cashucard.org');
  expect(words).toContain(origin);
});

test.each([
  ['https://cashu-card-ops.old-cell-30e7.workers.dev', 'ops.cashucard.org'],
  ['https://cards.example.com:8443', 'cards.example.com:8443'],
])(
  'sign-in labels the current service and offers a clear Change action for %s',
  async (origin, host) => {
    jest
      .mocked(useApp)
      .mockReturnValue({
        ...useApp(),
        serviceUrl: origin,
        serviceStatus: 'ready',
      });
    const choose = jest.fn();
    await render(<SignInScreen onServices={choose} />);
    expect(tree.root.findByProps({testID: 'sign-in-service-label'}).props.children).toBe('Ops service');
    expect(tree.root.findByProps({testID: 'sign-in-service-host'}).props.children).toBe(host);
    expect(tree.root.findByProps({testID: 'sign-in-service-change'}).props.children).toBe('Change');
    expect(action('sign-in-service').props.accessibilityLabel).toContain(
      `Current service: https://${host}`,
    );
    expect(choose).not.toHaveBeenCalled();
    await act(async () => action('sign-in-service').props.onPress());
    expect(choose).toHaveBeenCalledTimes(1);
  },
);
