import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {SettingsScreen} from '../src/screens/SettingsScreen';
import {useApp} from '../src/store';
jest.mock('../src/store', () => ({useApp: jest.fn()}));

test.each([
  ['issued', 'Issued'],
  ['factory', 'Factory'],
  [null, 'Sign in to view'],
] as const)(
  'Settings explains the account scope %s without implying a card-key selector',
  async (env, label) => {
    jest.mocked(useApp).mockReturnValue({
      session: env ? {operator_id: 1, env, token: 'public-test-token'} : null,
      theme: 'system',
      setTheme: jest.fn(),
      signOut: jest.fn(),
    } as unknown as ReturnType<typeof useApp>);
    let tree!: Renderer.ReactTestRenderer;
    await act(async () => {
      tree = Renderer.create(
        <SettingsScreen onBack={() => {}} onBench={() => {}} />,
      );
    });
    try {
      expect(
        tree.root.findByProps({testID: 'provisioning-scope-value'}).props
          .children,
      ).toBe(label);
      const help = () =>
        tree.root
          .findAllByProps({testID: 'provisioning-scope-help'})
          .find(node => node.props.accessibilityRole === 'button')!;
      expect(help().props.accessibilityRole).toBe('button');
      expect(help().props.accessibilityState.expanded).toBe(false);
      expect(
        tree.root.findAllByProps({testID: 'provisioning-scope-explanation'}),
      ).toHaveLength(0);
      await act(async () => help().props.onPress());
      expect(help().props.accessibilityState.expanded).toBe(true);
      const explanation = tree.root.findByProps({
        testID: 'provisioning-scope-explanation',
      }).props.children;
      expect(explanation).toContain('Saved batches and recovery work');
      expect(explanation).toContain('account');
      expect(explanation).toContain('does not read or change');
      await act(async () => help().props.onPress());
      expect(help().props.accessibilityState.expanded).toBe(false);
    } finally {
      await act(async () => tree.unmount());
    }
  },
);
