import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Text} from 'react-native';
import {SignInScreen} from '../src/screens/SignInScreen';
import {DARK, ThemeProvider} from '../src/theme';
import {useApp} from '../src/store';

jest.mock('../src/store', () => ({useApp: jest.fn()}));
let tree: Renderer.ReactTestRenderer;
beforeEach(() => {
  jest.mocked(useApp).mockReturnValue({
    serviceUrl: 'https://ops.cashucard.org',
    serviceStatus: 'ready',
  } as ReturnType<typeof useApp>);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
});

test('sign-in uses the shared forest Cashu Card identity and explicit field labels', async () => {
  await act(async () => {
    tree = Renderer.create(
      <ThemeProvider value={DARK}>
        <SignInScreen onServices={() => {}} />
      </ThemeProvider>,
    );
  });
  const logo = tree.root.findByProps({testID: 'sign-in-brand'});
  expect(logo.props.accessibilityLabel).toBe('Cashu Card');
  expect(logo.props.accessibilityRole).toBe('image');
  const text = tree.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toEqual(
    expect.arrayContaining([
      'Card provisioner',
      'Sign in',
      'Operator name',
      'Password',
    ]),
  );
  expect(text).not.toContain('⚡');
  expect(
    tree.root.findByProps({testID: 'sign-in-password'}).props.secureTextEntry,
  ).toBe(true);
  expect(
    tree.root.findByProps({testID: 'sign-in-service-host'}).props.children,
  ).toBe('ops.cashucard.org');
});

test.each(['dark'])(
  'the bundled %s logo matches the canonical brand artwork',
  mode => {
    const filename = `cashu-card-lockup-on-${mode}.svg`;
    expect(
      readFileSync(resolve(__dirname, '../src/assets/brand', filename)),
    ).toEqual(
      readFileSync(resolve(__dirname, '../../..', 'brand/lockup', filename)),
    );
  },
);
