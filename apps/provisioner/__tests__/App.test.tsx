/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders the load-test screen, its three runs, Cancel and the Replace switch', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const titles = tree!.root
    .findAll(
      n => typeof n.props.title === 'string' && typeof n.type !== 'string',
    )
    .map(n => n.props.title as string);
  expect([...new Set(titles)]).toEqual([
    'Smoke test (hello applet)',
    'Install Cashu card',
    'Rotate keys and back',
    'Cancel',
  ]);
  const status = tree!.root.findByProps({testID: 'status'});
  expect(status.props.children).toBe(
    'Hold the card against the back of the phone. Keep still until it finishes.',
  );
  expect(
    tree!.root.findAllByProps({
      accessibilityLabel: 'Replace existing install (spare card only)',
    }).length,
  ).toBeGreaterThan(0);
});
