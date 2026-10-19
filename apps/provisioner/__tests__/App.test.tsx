/**
 * The designed app's root and its routes: sign-in first, then the batch
 * setup, and demo mode's banner once the switch is on. The bench screen is
 * reached from Settings only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('signs in, then shows batch setup; demo mode raises its banner', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const text = () =>
    tree!.root
      .findAll(n => typeof n.props.children === 'string')
      .map(n => n.props.children as string)
      .join('\n');
  expect(text()).toContain('Cashu card provisioner');
  expect(text()).toContain('SIGN IN');

  await ReactTestRenderer.act(() => {
    tree!.root
      .findAllByProps({title: 'SIGN IN'})[0]
      .props.onPress();
  });
  expect(text()).toContain('NEW BATCH');

  await ReactTestRenderer.act(() => {
    tree!.root.findAllByProps({title: 'Settings'})[0].props.onPress();
  });
  await ReactTestRenderer.act(() => {
    tree!.root.findByProps({testID: 'demo-switch'}).props.onValueChange(true);
  });
  expect(text()).toContain('DEMO — no card, no record');
});
