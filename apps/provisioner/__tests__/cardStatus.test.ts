import {cardStatus, readCardStatus, type CardReadout} from '../src/cardStatus';
import {fromHex, toHex, type ResetReview} from '../src/cardkit';

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
  changeOwed: false,
  version: '2.2',
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
    [2, 3, 0x90, 0],
    [2, 4, 0x90, 0],
    [3, 1, 0x90, 0],
    [4, 0, 0x90, 0],
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
test('a 2.1 card, a 2.2 card (D175: GET_OUTBOX added) and a 3.0 card are all read past the version', async () => {
  const cplc = fromHex(
    '9f7f2a4790d32147000000000030410933632055470000000000000000048c2337323937360000000000000000',
  );
  for (const version of [
    [2, 1],
    [2, 2],
    [3, 0],
  ]) {
    const commands: number[][] = [];
    await readCardStatus(async a => {
      commands.push(a);
      if (a[1] === 0xca) {
        return [...cplc, 0x90, 0];
      }
      if (commands.length === 1) {
        return [0x90, 0];
      }
      if (commands.length === 3) {
        return [...version, 0x90, 0];
      }
      return [0x6d, 0];
    }).catch(() => undefined);
    // past SELECT's version, the reset review reads the card (and stops here at the fake's 6D00)
    expect(commands.length).toBeGreaterThan(3);
  }
});

test('a card owed change is told to bring it home through its holder wallet, before anything about value or reset', () => {
  for (const over of [
    {changeOwed: true},
    {changeOwed: true, owner: true, record: true},
    {changeOwed: true, unspent: 2},
    {changeOwed: true, spent: 1, version: '3.0'},
  ]) {
    const s = cardStatus(installed(over));
    expect(s).toMatchObject({
      title: 'Change is still owed to the card',
      action: 'holder',
    });
    expect(s.detail).toContain('brings the change home');
    expect(s.detail).toContain('Reset is unavailable');
  }
});
test("a 3.0 card's spent entries are its holder wallet's to free: no promise of this app's settlement check", () => {
  const s = cardStatus(installed({spent: 2, version: '3.0'}));
  expect(s.title).toBe('Check earlier payments');
  expect(s.detail).toContain('holder wallet frees spent entries');
  expect(s.detail).not.toContain('Reset will independently check settlement');
  expect(cardStatus(installed({spent: 2, version: '2.2'})).detail).toContain(
    'Reset will independently check settlement',
  );
});
// Answers a 3.0 card gave in jCardSim, status words included: one unspent piece, and owing change with no piece.
const STATUS_30 = {
  sel: '03009000',
  piece: '03008001007fff0104030001000003e8016b49d2000000000000000000009000',
  owed: '030080000080ff0104030001000003e8016b49d2000000000000000000019000',
  pub: '02fa05ed0a3649886270bacec5ddc1a3643009a759bee996f9a6ac060c9992a82e9000',
  card: '040100000003e80279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ffff7f20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002068747470733a2f2f6d696e742e6578616d706c652e636f6d2f426974636f696e0000009000',
};
function replay30(info: string, format = 4) {
  const cplc =
    '9f7f2a4790d321470000000000304109336120554700000000000000000434a939333336310000000000000000';
  return async (a: number[]) => {
    const h = toHex(a).toUpperCase();
    if (h.startsWith('00A40400') && h.includes('A000000151000000'))
      return [0x90, 0];
    if (h.startsWith('80CA9F7F')) return [...fromHex(cplc), 0x90, 0];
    if (h.startsWith('00A40400') && h.includes('F043415348554341524401'))
      return fromHex(STATUS_30.sel);
    if (h.startsWith('00A40400') && h.includes('D2760000850101'))
      return [0x90, 0];
    if (h.startsWith('B0010000')) {
      const r = fromHex(info);
      r[8] = format;
      return r;
    }
    if (h.startsWith('B0100000')) return fromHex(STATUS_30.pub);
    if (h.startsWith('B0160000')) {
      const r = fromHex(STATUS_30.card);
      r[0] = format;
      return r;
    }
    throw new Error('unexpected ' + h);
  };
}
test('a 3.0 card read from its answers: owing change says so, and a card of two units (format 05) is read', async () => {
  const owed = await readCardStatus(replay30(STATUS_30.owed));
  expect(owed.state).toBe('present');
  expect(cardStatus(owed).title).toBe('Change is still owed to the card');
  const two = await readCardStatus(replay30(STATUS_30.piece, 5));
  expect(two.state).toBe('present');
  expect(cardStatus(two).title).toBe('Card has value');
});
