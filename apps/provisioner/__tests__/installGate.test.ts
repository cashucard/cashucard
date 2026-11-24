/**
 * The installation gate (D239): a card is installed only when this build's
 * load file is approved AND a maker's own name and tag address are saved on
 * the phone. A fork's maker file only pre-fills the form. One pure function,
 * every case.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  EXAMPLE_MAKER_NAME,
  MAKER_FILE,
  MAKER_KEY_PREFIX,
  decodeSavedMaker,
  encodeSavedMaker,
  makerAddressProblem,
  makerAnswerFor,
  makerFromFile,
  makerNameProblem,
} from '../src/maker';
import {
  GATE_WORDS,
  installGate,
  passedInstallGate,
} from '../src/releaseGates';
import {cashuPlanFor, tagInstallParameters} from '../src/cardkit';
import {EXAMPLE_FILE, gatedMaker} from '../test-support/maker';

const FOXY = {name: 'Foxy', tagAddress: 'https://getfoxy.io/card'};
const FORK_FILE = {
  example: false,
  name: 'Island Cards',
  tagAddress: 'https://cards.islandbitcoin.com/c',
};
const gate = (
  saved: Parameters<typeof installGate>[0]['saved'],
  loadFileValidated = true,
  reading = false,
) => installGate({loadFileValidated, saved, reading});
const vectors: {
  valid: {address: string}[];
  invalid: {why: string; hex: string}[];
} = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../spec/vectors/tag-address.json'),
    'utf8',
  ),
);
const fromHexText = (hex: string) =>
  (hex.match(/../g) ?? [])
    .map(byte => String.fromCharCode(parseInt(byte, 16)))
    .join('');

test('no maker: the shared repository file is an example and pre-fills nothing', () => {
  expect(MAKER_FILE.example).toBe(true);
  expect(MAKER_FILE.name).toBe(EXAMPLE_MAKER_NAME);
  expect(makerFromFile(MAKER_FILE)).toBeNull();
  expect(gate(null)).toEqual({
    allowed: false,
    reason: 'no-maker',
    problem: GATE_WORDS.none,
  });
});

test('an old profile: a service saved by an earlier build has no maker and installs nothing', () => {
  // an earlier build wrote only cashu.provisioner.services.v1; the maker key is absent
  expect(MAKER_KEY_PREFIX).toBe('cashu.provisioner.maker.v1:');
  expect(decodeSavedMaker(null)).toBeNull();
  const old = gate(decodeSavedMaker(null));
  expect(old.allowed).toBe(false);
  expect(old).toMatchObject({reason: 'no-maker'});
});

test('the example maker and the example address are refused, typed in or in a file', () => {
  for (const tagAddress of [
    'https://example.com/card',
    'https://EXAMPLE.com/card',
    'https://www.example.org',
    'https://example.net:8443/x',
    'https://user@example.com/card',
    'https://cards.example/c',
    'https://maker.test/c',
    'https://localhost/c',
    'https://nothing.invalid/c',
  ]) {
    expect(makerAddressProblem(tagAddress)).toMatch(/example address/);
    expect(gate({name: 'Foxy', tagAddress})).toMatchObject({
      allowed: false,
      reason: 'bad-maker',
    });
  }
  expect(gate({name: 'example card maker ', tagAddress: FOXY.tagAddress})).toMatchObject({
    allowed: false,
    reason: 'bad-maker',
  });
  // a file marked as the example pre-fills nothing, whatever it holds
  expect(makerFromFile({...FORK_FILE, example: true})).toBeNull();
  // a file that forgot the mark but kept the example's values pre-fills nothing either
  expect(makerFromFile({...EXAMPLE_FILE, example: false})).toBeNull();
  // names near the example's are a maker's own business
  expect(makerAddressProblem('https://example.com.getfoxy.io/c')).toBeNull();
  expect(makerAddressProblem('https://myexample.com/c')).toBeNull();
});

test('a % in the host is refused: a phone would decode it, and an example name could hide behind it', () => {
  for (const tagAddress of [
    'https://e%78ample.com/card',
    'https://e%78ample.org',
    'https://x.%74est/c',
    'https://getfoxy%2eio/card',
    'https://us%65r@getfoxy.io/card',
    'https://getfoxy.io%2fcard?x=1',
  ]) {
    expect(makerAddressProblem(tagAddress)).toMatch(/host name cannot hold %/);
    expect(gate({name: 'Foxy', tagAddress})).toMatchObject({
      allowed: false,
      reason: 'bad-maker',
    });
  }
  // after the first / or ? a % is the maker's own business
  expect(makerAddressProblem('https://getfoxy.io/c%20d?x=%41')).toBeNull();
  expect(makerAddressProblem('https://getfoxy.io?x=%41')).toBeNull();
});

test('a bad address is refused by every rule class of the tag (spec/vectors/tag-address.json)', () => {
  expect(vectors.invalid.length).toBeGreaterThanOrEqual(20);
  for (const v of vectors.invalid) {
    const tagAddress = fromHexText(v.hex);
    expect([v.why, makerAddressProblem(tagAddress)]).toEqual([
      v.why,
      expect.any(String),
    ]);
    expect([v.why, gate({name: 'Foxy', tagAddress})]).toEqual([
      v.why,
      expect.objectContaining({allowed: false, reason: 'bad-maker'}),
    ]);
  }
  // one of each class, spelled out
  for (const tagAddress of [
    '',
    'http://getfoxy.io/card',
    'HTTPS://getfoxy.io/card',
    'https://',
    'https:///card',
    `https://getfoxy.io/${'a'.repeat(110)}`,
    'https://getfoxy.io/a card',
    'https://getfoxy.io/card#new',
    'https://getfoxy.io/cärd',
  ]) {
    expect(gate({name: 'Foxy', tagAddress}).allowed).toBe(false);
  }
  // not a string at all (a damaged setting)
  expect(gate({name: 'Foxy', tagAddress: 7 as unknown as string}).allowed).toBe(false);
});

test('a bad maker name is refused', () => {
  for (const name of ['', '   ', 'a'.repeat(65), 'Fo\nxy', EXAMPLE_MAKER_NAME]) {
    expect(makerNameProblem(name)).toEqual(expect.any(String));
    expect(gate({name, tagAddress: FOXY.tagAddress})).toMatchObject({
      allowed: false,
      reason: 'bad-maker',
    });
  }
  expect(makerNameProblem('a'.repeat(64))).toBeNull();
});

test('a good maker passes, and the install plan carries exactly its address', () => {
  const g = gate(FOXY);
  expect(g).toEqual({allowed: true, maker: FOXY});
  if (!g.allowed) {
    throw new Error('unreachable');
  }
  expect(Object.isFrozen(g.maker)).toBe(true);
  const plan = cashuPlanFor(g.maker);
  const tag = plan.installs[plan.installs.length - 1];
  expect(tag.phase).toBe('installTag');
  // every valid vector that is not an example address passes too
  const own = vectors.valid.filter(v => !/example/i.test(v.address));
  expect(own.length).toBeGreaterThanOrEqual(1);
  expect(tag).toMatchObject({
    parameters: tagInstallParameters(FOXY.tagAddress),
  });
  for (const v of own) {
    expect(gate({name: 'Foxy', tagAddress: v.address})).toMatchObject({
      allowed: true,
      maker: {tagAddress: v.address},
    });
  }
});

test('the build half still holds: an unapproved load file installs nothing, whatever the maker', () => {
  expect(gate(FOXY, false)).toEqual({
    allowed: false,
    reason: 'load-file',
    problem: GATE_WORDS.loadFile,
  });
  expect(
    installGate({
      loadFileValidated: 'yes' as unknown as boolean,
      saved: FOXY,
    }).allowed,
  ).toBe(false);
});

test("a fork's own maker file pre-fills the form and opens no gate: nothing installs until a maker is saved", () => {
  expect(makerFromFile(FORK_FILE)).toEqual({
    name: FORK_FILE.name,
    tagAddress: FORK_FILE.tagAddress,
  });
  // the gate takes no file at all: with nothing saved on the phone it is closed
  expect(gate(null)).toEqual({
    allowed: false,
    reason: 'no-maker',
    problem: GATE_WORDS.none,
  });
  expect(
    installGate({
      loadFileValidated: true,
      saved: null,
      file: FORK_FILE,
    } as Parameters<typeof installGate>[0]).allowed,
  ).toBe(false);
  // saved on the phone, the same name and address pass
  expect(gate(makerFromFile(FORK_FILE))).toMatchObject({
    allowed: true,
    maker: {name: FORK_FILE.name, tagAddress: FORK_FILE.tagAddress},
  });
  // a fork's file with a bad address pre-fills nothing
  expect(makerFromFile({...FORK_FILE, tagAddress: 'http://x.io'})).toBeNull();
});

test('a setting that is being read, or cannot be read, installs nothing', () => {
  expect(gate(undefined)).toEqual({
    allowed: false,
    reason: 'maker-unread',
    problem: GATE_WORDS.unread,
  });
  // the first read is in flight: closed, and with no words about a failed read
  expect(gate(undefined, true, true)).toEqual({
    allowed: false,
    reason: 'maker-reading',
    problem: '',
  });
  expect(gate(FOXY, true, true).allowed).toBe(false);
  // a saved maker that breaks a rule is refused
  expect(gate({name: 'Foxy', tagAddress: 'https://example.com/card'}).allowed).toBe(false);
  for (const damaged of [
    'not json',
    '[]',
    '{"schema":2,"name":"Foxy","tagAddress":"https://getfoxy.io/card"}',
    '{"schema":1,"name":"Foxy"}',
    '{"schema":1,"name":"Foxy","tagAddress":7}',
    '{"schema":1,"name":"Foxy","tagAddress":"https://getfoxy.io/card","extra":1}',
    `{"schema":1,"name":"Foxy","tagAddress":"https://getfoxy.io/${'a'.repeat(5000)}"}`,
  ]) {
    expect(() => decodeSavedMaker(damaged)).toThrow();
  }
  expect(decodeSavedMaker(encodeSavedMaker(FOXY))).toEqual(FOXY);
});

test('the card plan is built only from a gated maker, and checks the rules once more', () => {
  expect(cashuPlanFor(gatedMaker()).name).toBe('Cashu card');
  // a value forged past the type is still stopped before any card is touched
  const forged = EXAMPLE_FILE as unknown as Parameters<typeof cashuPlanFor>[0];
  expect(() => cashuPlanFor(forged)).toThrow(RangeError);
  expect(() =>
    cashuPlanFor({
      name: 'Foxy',
      tagAddress: 'http://getfoxy.io',
    } as unknown as Parameters<typeof cashuPlanFor>[0]),
  ).toThrow(RangeError);
});

test('only the object the gate handed out builds a plan: a look-alike with a good name and address is refused', () => {
  const real = gatedMaker(FOXY);
  expect(passedInstallGate(real)).toBe(true);
  expect(cashuPlanFor(real).name).toBe('Cashu card');
  for (const lookAlike of [
    {...real},
    Object.freeze({...real}),
    Object.freeze({name: FOXY.name, tagAddress: FOXY.tagAddress}),
    Object.create(real),
  ]) {
    expect(passedInstallGate(lookAlike)).toBe(false);
    expect(() =>
      cashuPlanFor(lookAlike as Parameters<typeof cashuPlanFor>[0]),
    ).toThrow(/did not pass the installation gate/);
  }
  for (const nothing of [null, undefined, 'Foxy', 7]) {
    expect(passedInstallGate(nothing)).toBe(false);
  }
});

test("a maker read for one ops service is no answer for another: the gate stays closed until that service's own is read", () => {
  const forA = {origin: 'https://ops.test', value: FOXY};
  expect(makerAnswerFor(forA, 'https://ops.test')).toBe(forA);
  for (const other of [
    'https://issuer.example.com',
    'https://ops.test:8443',
    'https://ops.test.evil.io',
    '',
  ]) {
    const answer = makerAnswerFor(forA, other);
    expect(answer).toBeUndefined();
    // the store's wiring: no answer for this service means the read is in flight
    expect(
      installGate({
        loadFileValidated: true,
        saved: answer?.value,
        reading: answer === undefined,
      }),
    ).toMatchObject({allowed: false, reason: 'maker-reading'});
  }
  expect(makerAnswerFor(undefined, 'https://ops.test')).toBeUndefined();
});
