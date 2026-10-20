/**
 * The designed app's root and its routes: the app opens on sign-in (ENG-740 —
 * the ops service issues real operator sessions), batch setup follows a
 * signed-in session, and demo mode's banner once the switch is on. The bench
 * screen is reached from Settings only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('opens on sign-in; a signed-in session reaches batch setup; demo mode raises its banner', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const text = () =>
    tree!.root
      .findAll(n => typeof n.props.children === 'string')
      .map(n => n.props.children as string)
      .join('\n');
  expect(text()).toContain('SIGN IN');

  // Sign in through the mocked api module (jest.mock at the bottom of the file
  // would race this hoisting; the store accepts a client via signIn's options,
  // so the test drives the store's own seam).
  const {ApiClient} = require('../src/api');
  jest
    .spyOn(ApiClient.prototype, 'operatorSession')
    .mockResolvedValue({env: 'issued', token: 'test-token'});
  await ReactTestRenderer.act(async () => {
    await tree!.root.findByProps({testID: 'sign-in'}).props.onPress();
  });
  expect(text()).toContain('NEW BATCH');

  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'settings'}).props.onPress();
  });
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'demo-switch'}).props.onValueChange(true);
  });
  expect(text()).toContain('DEMO — no card, no record');

  // the theme pill changes what the screens draw: dark then light
  const bg = () =>
    tree!.root.findByType(require('react-native').SafeAreaView).props.style;
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'theme-dark'}).props.onPress();
  });
  expect(bg().backgroundColor).toBe('#050505');
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'theme-light'}).props.onPress();
  });
  expect(bg().backgroundColor).toBe('#FAFAF8');
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
