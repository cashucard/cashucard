/**
 * The designed app's whole shared state: the sign-in stub, the demo switch,
 * the open batch and its record rows. In-memory only — the real records land
 * with the ops service (Phase 3); demo rows never leave the phone.
 */
import React, {createContext, useContext, useMemo, useState} from 'react';

import type {DemoStateId} from './strings';

export interface BatchConfig {
  mint: string;
  pinPolicy: 'batch' | 'perCard';
  pinBatch: string;
  dailyUsd: number;
  noPinUsd: number;
  count: number;
}

export interface RecordRow {
  id: string; // the card's short id, or the demo state's
  ok: boolean;
  demo?: DemoStateId;
  at: number; // epoch ms
  pending: boolean; // registry write outstanding (never in demo)
}

export interface AppState {
  signedIn: boolean;
  demo: boolean;
  theme: 'system' | 'dark' | 'light';
  batch: (BatchConfig & {done: RecordRow[]}) | null;
  signIn(): void;
  setDemo(on: boolean): void;
  setTheme(t: 'system' | 'dark' | 'light'): void;
  startBatch(config: BatchConfig): void;
  endBatch(): void;
  addRecord(row: RecordRow): void;
}

const Ctx = createContext<AppState | null>(null);

export const DEMO_BATCH: BatchConfig = {
  mint: 'https://mint.demo.invalid',
  pinPolicy: 'perCard',
  pinBatch: '',
  dailyUsd: 25,
  noPinUsd: 5,
  count: 12,
};

export function AppStore({children}: {children: React.ReactNode}) {
  const [signedIn, setSignedIn] = useState(false);
  const [demo, setDemo] = useState(false);
  const [theme, setTheme] = useState<'system' | 'dark' | 'light'>('system');
  const [batch, setBatch] = useState<
    (BatchConfig & {done: RecordRow[]}) | null
  >(null);

  const value = useMemo<AppState>(
    () => ({
      signedIn,
      demo,
      theme,
      batch,
      signIn: () => setSignedIn(true),
      setDemo: setDemo,
      setTheme,
      startBatch: config => setBatch({...config, done: []}),
      endBatch: () => setBatch(null),
      addRecord: row =>
        setBatch(b => (b ? {...b, done: [...b.done, row]} : b)),
    }),
    [signedIn, demo, theme, batch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const s = useContext(Ctx);
  if (!s) {
    throw new Error('AppState outside its provider');
  }
  return s;
}

/** The card's screen id: the last bytes of its applet public key, hex. */
export function shortIdOf(pubkey: readonly number[]): string {
  return pubkey
    .slice(-2)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
