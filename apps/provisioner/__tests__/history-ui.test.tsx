import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {ThemeProvider, DARK} from '../src/theme';
import {BatchHistory} from '../src/screens/ProvisioningScreen';

test('large history mounts twenty rows at a time and pages to older attempts', async () => {
  const history = Array.from({length: 41}, (_, ordinal) => ({
    ordinal,
    attempt_id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    stage: 'quarantined' as const,
    quarantine_reason: 'identity-mismatch',
  }));
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <ThemeProvider value={DARK}>
        <BatchHistory history={history} />
      </ThemeProvider>,
    );
  });
  const visibleRows = () =>
    tree.root.findAllByProps({testID: 'history-row'}).filter(node => typeof node.type === 'string').length;
  expect(visibleRows()).toBe(20);
  await act(async () => {
    tree.root.findByProps({testID: 'history-older'}).props.onPress();
  });
  expect(visibleRows()).toBe(20);
  await act(async () => {
    tree.root.findByProps({testID: 'history-older'}).props.onPress();
  });
  expect(visibleRows()).toBe(1);
  tree.unmount();
});
