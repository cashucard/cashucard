/**
 * The designed app's root and its routes: the app opens on sign-in (ENG-740 —
 * the ops service issues real operator sessions), batch setup follows a
 * signed-in session, and demo mode's banner once the switch is on. The bench
 * screen is reached from Settings only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import GearSvg from '../src/assets/gear.svg';
import {AppStore} from '../src/store';
import {SettingsScreen} from '../src/screens/SettingsScreen';
import {GearButton} from '../src/ui';
import {DARK, ThemeProvider} from '../src/theme';

test('opens on sign-in; a signed-in session reaches batch setup; demo mode raises its banner', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <App
        recovery={{
          storage: {read: async () => null, replace: async () => undefined},
          uuid: () => '00000000-0000-4000-8000-000000000001',
        }}
      />,
    );
  });
  const text = () =>
    tree!.root
      .findAll(n => typeof n.props.children === 'string')
      .map(n => n.props.children as string)
      .join('\n');
  expect(text()).toContain('SIGN IN');
  expect(text()).toContain('Privacy Policy');
  expect(text()).toContain('Terms');
  expect(text()).toContain('Support');
  const {Linking} = require('react-native');
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await ReactTestRenderer.act(async () => {
    await tree!.root.findByProps({testID: 'legal-privacy'}).props.onPress();
    await tree!.root.findByProps({testID: 'legal-terms'}).props.onPress();
    await tree!.root.findByProps({testID: 'legal-support'}).props.onPress();
  });
  expect(openURL.mock.calls).toEqual([
    ['https://getflash.io/legal/privacy.html'],
    ['https://getflash.io/legal/terms.html'],
    ['mailto:support@getflash.io'],
  ]);

  const {Alert} = require('react-native');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  openURL.mockRejectedValueOnce(new Error('private native details'));
  await ReactTestRenderer.act(async () => {
    await tree!.root.findByProps({testID: 'legal-privacy'}).props.onPress();
  });
  expect(alert).toHaveBeenCalledWith(
    'Unable to open link',
    'Please try again later.',
  );

  openURL.mockRejectedValueOnce(new Error('no mail app'));
  await ReactTestRenderer.act(async () => {
    await tree!.root.findByProps({testID: 'legal-support'}).props.onPress();
  });
  expect(alert).toHaveBeenLastCalledWith(
    'Unable to open link',
    'Email support@getflash.io from your preferred email app.',
  );

  // Sign in through the mocked api module (jest.mock at the bottom of the file
  // would race this hoisting; the store accepts a client via signIn's options,
  // so the test drives the store's own seam).
  const {ApiClient} = require('../src/api');
  jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockResolvedValue({operator_id: 1, env: 'issued', token: 'test-token'});
  // S1's typed credentials: the screen no longer carries a default operator.
  await ReactTestRenderer.act(async () => {
    await tree!.root
      .findByProps({testID: 'sign-in-name'})
      .props.onChangeText('bench-lead');
    await tree!.root
      .findByProps({testID: 'sign-in-password'})
      .props.onChangeText('pw');
  });
  await ReactTestRenderer.act(async () => {
    await tree!.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  expect(text()).toContain('NEW BATCH');

  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'settings'}).props.onPress();
  });
  expect(tree!.root.findByProps({testID: 'legal-privacy'})).toBeDefined();
  expect(tree!.root.findByProps({testID: 'legal-terms'})).toBeDefined();
  expect(tree!.root.findByProps({testID: 'legal-support'})).toBeDefined();
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'demo-switch'}).props.onValueChange(true);
  });
  expect(text()).toContain('DEMO — no card, no record');

  // the theme pill changes what the screens draw: dark then light
  const bg = () =>
    tree!.root.findByType(
      require('react-native-safe-area-context').SafeAreaView,
    ).props.style;
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'theme-dark'}).props.onPress();
  });
  expect(bg().backgroundColor).toBe('#050505');
  expect(
    tree!.root.findByType(require('react-native').StatusBar).props.barStyle,
  ).toBe('light-content');
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'theme-light'}).props.onPress();
  });
  expect(bg().backgroundColor).toBe('#FAFAF8');
  expect(
    tree!.root.findByType(require('react-native').StatusBar).props.barStyle,
  ).toBe('dark-content');
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'theme-system'}).props.onPress();
  });
  expect(['#050505', '#FAFAF8']).toContain(bg().backgroundColor);

  // Unmount so the store's retry interval (a signed-in session arms it) does
  // not hold the test process open.
  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
  jest.restoreAllMocks();
});

test('the sign-in screen demo door enters demo mode with no session (design review without a service)', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <App
        recovery={{
          storage: {read: async () => null, replace: async () => undefined},
          uuid: () => '00000000-0000-4000-8000-000000000001',
        }}
      />,
    );
  });
  const text = () =>
    tree!.root
      .findAll(n => typeof n.props.children === 'string')
      .map(n => n.props.children as string)
      .join('\n');
  expect(text()).toContain('SIGN IN');

  // No ApiClient mock here: pressing the demo door must not sign in at all —
  // demo runs with session null, no service reached.
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'demo-entry'}).props.onPress();
  });
  // Past the gate, into the batch screen, with the demo marks up.
  expect(text()).toContain('NEW BATCH');
  expect(text()).toContain('DEMO — no card, no record');
  expect(text()).toContain('Demo batch — placeholder values');

  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'settings'}).props.onPress();
  });
  expect(tree!.root.findAllByProps({testID: 'bench-entry'})).toHaveLength(0);
  expect(tree!.root.findByProps({testID: 'identity-entry'})).toBeTruthy();
  await ReactTestRenderer.act(() => {
    tree!.root.findByType(SettingsScreen).props.onBench();
  });
  expect(tree!.root.findByType(SettingsScreen)).toBeTruthy();
  await ReactTestRenderer.act(() => {
    tree!.root.findByType(SettingsScreen).props.onBack();
  });

  // Demo rows are reachable: the loop's demo chooser is present.
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'start-batch'}).props.onPress();
  });
  expect(tree!.root.findByProps({testID: 'demo-ok'})).toBeTruthy();

  await ReactTestRenderer.act(() => {
    tree!.unmount();
  });
});

test('settings confirms sign-out while a saved batch exists', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <AppStore>
        <SettingsScreen
          onBack={() => undefined}
          onBench={() => undefined}
          hasSavedBatch
        />
      </AppStore>,
    );
  });
  await ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'sign-out'}).props.onPress();
  });
  expect(tree.root.findByProps({testID: 'confirm-sign-out'})).toBeTruthy();
  await ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'keep-session'}).props.onPress();
  });
  expect(tree.root.findByProps({testID: 'sign-out'})).toBeTruthy();
  const words = tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children)
    .join(' ');
  expect(words).toContain('Version 1.0.0 (6)');
  expect(words).toContain('CAP pin f27d92ba');
  tree.unmount();
});

test('the settings gear receives its theme tint through the SVG color prop', () => {
  const tree = ReactTestRenderer.create(
    <ThemeProvider value={DARK}>
      <GearButton onPress={() => undefined} />
    </ThemeProvider>,
  );
  expect(tree.root.findByType(GearSvg).props.color).toBe(DARK.dim);
  tree.unmount();
});
