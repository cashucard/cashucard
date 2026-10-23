import React from 'react';
import Renderer from 'react-test-renderer';
import {Pressable} from 'react-native';
import {ThemeProvider, DARK} from '../src/theme';
import {GearButton, PrimaryButton, SecondaryButton} from '../src/ui';

test('shared actions expose button roles, labels, and disabled state', () => {
  const tree = Renderer.create(
    <ThemeProvider value={DARK}>
      <PrimaryButton
        title="CREATE BATCH"
        onPress={() => undefined}
        disabled
        testID="primary"
      />
      <SecondaryButton
        title="CANCEL TAP"
        onPress={() => undefined}
        testID="secondary"
      />
      <GearButton onPress={() => undefined} testID="gear" />
    </ThemeProvider>,
  );
  const action = (id: string) =>
    tree.root.findByProps({testID: id}).findByType(Pressable).props;
  expect(action('primary').accessibilityRole).toBe('button');
  expect(action('primary').accessibilityLabel).toBe('CREATE BATCH');
  expect(action('primary').accessibilityState).toEqual({disabled: true});
  expect(action('secondary').accessibilityRole).toBe('button');
  expect(action('secondary').accessibilityLabel).toBe('CANCEL TAP');
  expect(action('gear').accessibilityRole).toBe('button');
  expect(action('gear').accessibilityLabel).toBe('Settings');
  tree.unmount();
});
