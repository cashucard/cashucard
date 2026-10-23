import {cardStatus, readCardStatus, type CardReadout} from '../src/cardStatus';
import {fromHex, type ResetReview} from '../src/cardkit';

const card: ResetReview = {
  chipId: 'cplc-v1:4790d3213041093363205547',
  installationId:
    '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  unspent: 0,
  spent: 0,
  owner: false,
  pin: false,
  pinBlocked: false,
  tries: 3,
  locked: false,
  record: false,
  tag: true,
  sealed: true,
  mint: '',
  recordDigest: 'ab'.repeat(32),
};
const installed = (over: Partial<ResetReview> = {}): CardReadout => ({
  state: 'present',
  chipId: card.chipId,
  card: {...card, ...over},
});
test('observed state produces a useful next action without calling an installed card spend-ready', () => {
  expect(cardStatus({state: 'blank', chipId: card.chipId}).action).toBe(
    'install',
  );
  expect(cardStatus(installed())).toMatchObject({
    title: 'Ready for wallet setup',
    action: 'holder',
  });
  expect(cardStatus(installed({owner: true, record: true}))).toMatchObject({
    title: 'Empty and linked to a wallet',
    action: 'holder',
  });
  expect(cardStatus(installed({owner: true, unspent: 4}))).toMatchObject({
    title: 'Card has value',
    action: 'holder',
  });
  expect(cardStatus(installed({owner: true, spent: 13}))).toMatchObject({
    title: 'Check earlier payments',
    action: 'holder',
  });
  expect(cardStatus(installed({pinBlocked: true}))).toMatchObject({
    title: 'PIN recovery needed',
    action: 'holder',
  });
  expect(cardStatus(installed({tag: false})).action).toBe('admin');
  expect(
    cardStatus({state: 'unsupported', chipId: card.chipId, version: '2.0'})
      .action,
  ).toBe('admin');
});
test('saved work and unresolved service history direct recovery rather than a fresh install or reset', () => {
  expect(
    cardStatus(
      {state: 'blank', chipId: card.chipId},
      {savedChip: card.chipId, savedStage: 'install_intent'},
    ).action,
  ).toBe('resume');
  expect(
    cardStatus(
      {state: 'unsupported', chipId: card.chipId, version: '2.0'},
      {savedChip: card.chipId, savedStage: 'rotation_intent'},
    ).action,
  ).toBe('admin');
  expect(
    cardStatus(installed(), {
      source: {can_reset: false, lookup: {status: 'unresolved'}},
    }).action,
  ).toBe('admin');
  expect(
    cardStatus(installed(), {savedChip: card.chipId, savedStage: 'quarantined'})
      .action,
  ).toBe('admin');
});
test('a blank card needs only identity and applet selection; unknown versions stop before more reads', async () => {
  const cplc = fromHex(
    '9f7f2a4790d32147000000000030410933632055470000000000000000048c2337323937360000000000000000',
  );
  for (const selected of [
    [0x6a, 0x82],
    [2, 0, 0x90, 0],
  ]) {
    const commands: number[][] = [];
    const result = await readCardStatus(async a => {
      commands.push(a);
      return a[1] === 0xca
        ? [...cplc, 0x90, 0]
        : commands.length === 1
        ? [0x90, 0]
        : selected;
    });
    expect(result.state).toBe(selected[0] === 0x6a ? 'blank' : 'unsupported');
    expect(commands.map(a => a[1])).toEqual([0xa4, 0xca, 0xa4]);
  }
});
