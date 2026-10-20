/**
 * The designed app's root and its routes: the app opens on batch setup (the
 * sign-in gate is removed until the ops service lands), and demo mode's
 * banner once the switch is on. The bench screen is reached from Settings
 * only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('opens on batch setup; demo mode raises its banner', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const text = () =>
    tree!.root
      .findAll(n => typeof n.props.children === 'string')
      .map(n => n.props.children as string)
      .join('\n');
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
});
