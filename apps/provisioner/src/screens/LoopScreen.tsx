/**
 * S3. The loop. One screen carries a batch: the counter, the card's own
 * printed art filling as the load writes, the commit, and every stop as a
 * panel with its three lines in order (what happened, what the card is now,
 * what to do). In demo mode the center is the state menu; a done state keeps
 * its result card — with the card's PIN — until NEXT CARD.
 */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, Vibration, View} from 'react-native';

import type {RunEvent} from '../cardkit';
import {CardFigure} from '../CardFigure';
import {runDemo, stopFor} from '../demo/runDemo';
import {
  DEMO_STATES,
  LOOP,
  PHASES,
  STOP,
  type DemoStateId,
} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Screen, SecondaryButton} from '../ui';

interface RunUi {
  phase: string;
  block?: {index: number; of: number};
}

const local = (t: Theme) =>
  StyleSheet.create({
    counter: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 44,
      textAlign: 'center',
    },
    figureWrap: {alignItems: 'center', marginVertical: 14},
    phase: {
      color: t.ink,
      fontFamily: FONT.medium,
      fontSize: 19,
      textAlign: 'center',
      minHeight: 26,
    },
    menu: {
      backgroundColor: t.card,
      borderRadius: 18,
      overflow: 'hidden',
    },
    menuRow: {
      paddingHorizontal: 18,
      paddingVertical: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    menuText: {flex: 1, gap: 2},
    menuName: {color: t.ink, fontFamily: FONT.semibold, fontSize: 17},
    menuSub: {color: t.dim, fontFamily: FONT.regular, fontSize: 13},
    menuDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: t.accent,
    },
    menuDotHollow: {
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: t.dim,
    },
    menuChevron: {color: t.dim, fontFamily: FONT.regular, fontSize: 22},
    menuDivider: {height: StyleSheet.hairlineWidth, backgroundColor: t.line},
    result: {
      backgroundColor: t.card,
      borderRadius: 18,
      padding: 20,
      gap: 8,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    resultDanger: {borderColor: t.danger},
    resultDone: {borderColor: t.accent},
    resultTitle: {color: t.ink, fontFamily: FONT.semibold, fontSize: 24},
    resultTitleDanger: {color: t.danger},
    resultLine: {color: t.dim, fontFamily: FONT.regular, fontSize: 16},
    resultNext: {color: t.ink, fontFamily: FONT.semibold, fontSize: 17},
    resultPin: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 34,
      letterSpacing: 6,
    },
    resultId: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 15,
    },
    chooser: {gap: 14},
    realOff: {gap: 12},
    endBatch: {marginTop: 'auto'},
    scroll: {gap: 12, paddingBottom: 24},
  });

export function LoopScreen({onEndBatch}: {onEndBatch: () => void}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [busy, setBusy] = useState(false);
  const [ui, setUi] = useState<RunUi>({phase: ''});
  /** The stop on screen, if any, and whether its action continues the run. */
  const [stop, setStop] = useState<{id: DemoStateId; cont: boolean} | null>(
    null,
  );
  /** Done only: the short id and, on per-card PIN policy, the PIN. Holds until NEXT CARD. */
  const [done, setDone] = useState<{id: string; pin?: string} | null>(null);
  /** After wrong-keys: the loop stays disarmed until the stop is answered. */
  const [needsAck, setNeedsAck] = useState(false);

  const batch = app.batch!;

  const onEvent = (e: RunEvent) => {
    if (e.type === 'block') {
      setUi(u => ({...u, block: {index: e.index, of: e.of}}));
    } else if (e.type === 'phase') {
      setUi({phase: e.phase});
    }
  };

  async function run(state: DemoStateId, replace: boolean) {
    setBusy(true);
    setStop(null);
    setDone(null);
    setUi({phase: 'probe'});
    const demoRun = await runDemo(state, {replace, onEvent});
    const stopId = stopFor(demoRun);
    setBusy(false);
    if (stopId === 'ok') {
      Vibration.vibrate(40);
      const id = Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0');
      const pin =
        batch.pinPolicy === 'perCard'
          ? String(Math.floor(1000 + Math.random() * 9000))
          : undefined;
      setDone({id, pin});
      app.addRecord({
        id,
        ok: true,
        demo: state,
        at: Date.now(),
        pending: false,
      });
    } else {
      const cont = (stopId === 'hasOld' || stopId === 'oldVersion') && !replace;
      setStop({id: stopId, cont});
      if (stopId === 'wrongKeys') {
        setNeedsAck(true);
      }
      app.addRecord({
        id: state,
        ok: false,
        demo: state,
        at: Date.now(),
        pending: false,
      });
    }
    setUi({phase: ''});
  }

  const runningPhase =
    ui.phase === 'load' && ui.block
      ? `Writing ${ui.block.index} of ${ui.block.of}`
      : PHASES[ui.phase] ?? '';

  const fill = done ? 1 : ui.block ? ui.block.index / ui.block.of : 0;
  const figureState = done
    ? 'done'
    : stop
      ? STOP[stop.id].danger
        ? 'danger'
        : 'stop'
      : busy
        ? 'running'
        : 'idle';

  const center = (() => {
    if (busy || done || stop) {
      return null; // the run panel below carries it
    }
    if (app.demo) {
      return (
        <View style={s.menu}>
          {DEMO_STATES.map((d, i) => (
            <React.Fragment key={d.id}>
              {i > 0 ? <View style={s.menuDivider} /> : null}
              <Pressable
                testID={`demo-${d.id}`}
                disabled={needsAck}
                onPress={() => run(d.id, false)}
                style={s.menuRow}>
                <View style={d.id === 'ok' ? s.menuDot : s.menuDotHollow} />
                <View style={s.menuText}>
                  <Text style={s.menuName}>{d.name}</Text>
                  <Text style={s.menuSub}>{d.sub}</Text>
                </View>
                <Text style={s.menuChevron}>›</Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      );
    }
    return (
      <View style={s.realOff}>
        <Dim>{LOOP.idle}</Dim>
        <PrimaryButton title={LOOP.program} disabled onPress={() => undefined} />
        <Dim>
          {'Runs against real cards arrive with the key service (Phase 3).'}
        </Dim>
      </View>
    );
  })();

  return (
    <Screen title={app.demo ? 'Demo batch' : 'Batch'}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text testID="counter" style={s.counter}>
          {LOOP.of(batch.done.filter(r => r.ok).length, batch.count)}
        </Text>

        <View style={s.figureWrap}>
          <CardFigure fill={fill} state={figureState} />
        </View>

        <Text testID="phase-line" style={s.phase}>
          {busy ? runningPhase : ' '}
        </Text>

        {done ? (
          <View style={[s.result, s.resultDone]} testID="done">
            <Text style={s.resultTitle}>{LOOP.doneTitle}</Text>
            <Text style={s.resultId}>{LOOP.done(done.id)}</Text>
            {done.pin ? (
              <Text testID="pin-line" style={s.resultPin}>
                {LOOP.pinShown(done.pin)}
              </Text>
            ) : null}
            <PrimaryButton
              title={LOOP.next}
              testID="next-card"
              onPress={() => {
                setDone(null);
              }}
            />
          </View>
        ) : null}

        {stop ? (
          <View
            testID="stop"
            style={[
              s.result,
              STOP[stop.id].danger ? s.resultDanger : null,
            ]}>
            <Text
              style={[
                s.resultTitle,
                STOP[stop.id].danger ? s.resultTitleDanger : null,
              ]}>
              {STOP[stop.id].what}
            </Text>
            <Text style={s.resultLine}>{STOP[stop.id].card}</Text>
            <Text style={s.resultNext}>{STOP[stop.id].next}</Text>
            <PrimaryButton
              title={STOP[stop.id].action ?? 'OK'}
              danger={STOP[stop.id].danger}
              testID="stop-action"
              onPress={() => {
                if (stop.cont) {
                  run(stop.id, true);
                } else {
                  setStop(null);
                  setNeedsAck(false);
                }
              }}
            />
          </View>
        ) : null}

        {center}

        <View style={s.endBatch}>
          <SecondaryButton title="END BATCH" onPress={onEndBatch} />
        </View>
      </ScrollView>
    </Screen>
  );
}
