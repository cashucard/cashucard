import React from 'react';
import {SecondaryButton} from '../src/ui';
import ReactTestRenderer from 'react-test-renderer';
import {LoadTestScreen} from '../src/screens/LoadTestScreen';
import {cancelCard, withCard} from '../src/session';

jest.mock('../src/session', () => ({
  ...jest.requireActual('../src/session'),
  withCard: jest.fn().mockRejectedValue(new Error('must not open NFC')),
  cancelCard: jest.fn(),
  setCardMessage: jest.fn(),
}));

test('disabled bench handlers never open NFC even if invoked directly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<LoadTestScreen />);
  });
  try {
    const buttons = tree!.root.findAllByType(SecondaryButton);
    expect(buttons).toHaveLength(4);
    // Exercise install-hello, install-Cashu and key-rotation handlers directly,
    // bypassing the native button's disabled attribute and all navigation.
    for (const button of buttons.slice(0, 3)) {
      await ReactTestRenderer.act(async () => {
        await button.props.onPress();
      });
    }
    expect(withCard).not.toHaveBeenCalled();
    expect(buttons.slice(0, 3).every(button => button.props.disabled)).toBe(
      true,
    );
  } finally {
    await ReactTestRenderer.act(() => tree!.unmount());
  }
  expect(cancelCard).not.toHaveBeenCalled();
});
