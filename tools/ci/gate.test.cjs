const assert = require('node:assert/strict');
const test = require('node:test');
const {checkResults} = require('./gate.cjs');
const {JOBS} = require('./affected.cjs');

function results(selected = []) {
  return Object.fromEntries([
    ['changes', {result: 'success', outputs: {selected: JSON.stringify(selected)}}],
    ['policy', {result: 'success'}],
    ...JOBS.map(id => [id, {result: selected.includes(id) ? 'success' : 'skipped'}]),
  ]);
}
test('the gate accepts a docs-only PR and a completed full matrix', () => {
  assert.equal(checkResults(results()), true);
  assert.equal(checkResults(results(JOBS)), true);
});
test('skipped, failed and cancelled selected jobs cannot produce a green gate', () => {
  for (const result of ['skipped', 'failure', 'cancelled']) {
    const data = results(['ops']); data.ops.result = result;
    assert.throws(() => checkResults(data));
  }
});
test('change detection, policy checks and missing job wiring cannot be bypassed', () => {
  for (const id of ['changes', 'policy']) {
    const data = results(); data[id].result = 'failure';
    assert.throws(() => checkResults(data));
  }
  const missing = results(); delete missing.cardkit;
  assert.throws(() => checkResults(missing));
  const malformed = results(); malformed.changes.outputs.selected = 'not-json';
  assert.throws(() => checkResults(malformed));
  assert.throws(() => checkResults(results(['misspelled-job'])));
});
