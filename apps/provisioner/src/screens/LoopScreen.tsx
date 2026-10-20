/**
 * S3. The loop. One screen carries a batch: the counter, the card's own
 * printed art filling as the load writes, the commit, and every stop as a
 * panel with its three lines in order (what happened, what the card is now,
 * what to do). In demo mode the center is the state menu; a done state keeps
 * its result card — with the card's PIN — until NEXT CARD.
 *
 * The design tier of the batch and settings screens: the counter is the
 * screen's headline (tabular, with the batch's real progress bar under it),
 * the figure sits in the middle at the largest size that never scrolls, and
 * panels — done, stop, demo menu — share the grouped-card language: one
 * raised card, hairline dividers, the accent only where a thing is live.
 */
import React, {useCallback, useEffect, useRef, useState, Fragment} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';

import type {RunEvent} from '../cardkit';
import {CardFigure} from '../CardFigure';
import {runDemo, stopFor} from '../demo/runDemo';
import {DEMO_STATES, LOOP, PHASES, STOP, type DemoStateId} from '../strings';
import {useApp} from '../store';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Screen, SecondaryButton} from '../ui';

interface RunUi {
  phase: string;
  block?: {index: number; of: number};
}

/**
 * The real-mode registry row's placeholders until ENG-741 wires the real
 * batch id and escrow ordinal. A `0` here cannot reach the service: with
 * foreign_keys ON and no batch row 0, the POST is a 500 and the row is
 * pending forever (the finding this guard exists for).
 */
const PLACEHOLDER_BATCH_ID = 0;
const PLACEHOLDER_ORDINAL = 0;

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 14, paddingBottom: 24, flexGrow: 1},
    head: {alignItems: 'center', gap: 10, marginTop: 4},
    counter: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 56,
      letterSpacing: 1,
      textAlign: 'center',
    },
    progress: {
      alignSelf: 'stretch',
      height: 4,
      borderRadius: 2,
      backgroundColor: t.line,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 2,
      backgroundColor: t.accent,
    },
    figureWrap: {
      alignItems: 'center',
      marginVertical: 10,
      flex: 1,
      justifyContent: 'center',
    },
    phase: {
      color: t.ink,
      fontFamily: FONT.medium,
      fontSize: 17,
      textAlign: 'center',
      minHeight: 24,
      letterSpacing: 0.3,
    },
    idleLine: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 15,
      textAlign: 'center',
      minHeight: 22,
    },
    panel: {
      backgroundColor: t.card,
      borderRadius: 18,
      overflow: 'hidden',
    },
    panelDivider: {height: StyleSheet.hairlineWidth, backgroundColor: t.line},
    menuRow: {
      paddingHorizontal: 18,
      paddingVertical: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
    },
    menuText: {flex: 1, gap: 2},
    menuName: {color: t.ink, fontFamily: FONT.semibold, fontSize: 16},
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
    result: {
      backgroundColor: t.card,
      borderRadius: 18,
      padding: 22,
      gap: 10,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
    },
    resultDanger: {borderColor: t.danger},
    resultDone: {borderColor: t.accent},
    resultTitle: {color: t.ink, fontFamily: FONT.semibold, fontSize: 22},
    resultTitleDanger: {color: t.danger},
    resultLine: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 15,
      textAlign: 'center',
    },
    resultNext: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 16,
      textAlign: 'center',
    },
    resultPin: {
      color: t.ink,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 36,
      letterSpacing: 8,
      marginTop: 2,
    },
    resultPinLabel: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    resultId: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 14,
    },
    resultAction: {alignSelf: 'stretch', marginTop: 6},
    footer: {gap: 10, paddingBottom: 4},
    realOff: {gap: 12, alignItems: 'center', paddingVertical: 12},
    pinBlock: {alignItems: 'center', gap: 4},
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
  /** Done only: the short id and, on per-card PIN policy, the PIN. Holds until auto-rearm. */
  const [done, setDone] = useState<{id: string; pin?: string} | null>(null);
  /** After wrong-keys: the loop stays disarmed until the stop is answered. */
  const [needsAck, setNeedsAck] = useState(false);
  /** Real mode before ENG-741: the done panel says the record is held. */
  const [placeholderNote, setPlaceholderNote] = useState(false);
  /** Auto-rearm timer for done state. */
  const autoRearmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track if we're in the middle of a run to show cancel button. */
  const [runArmed, setRunArmed] = useState(false);

  const batch = app.batch!;

  const onEvent = useCallback((e: RunEvent) => {
    if (e.type === 'block') {
      setUi(u => ({...u, block: {index: e.index, of: e.of}}));
    } else if (e.type === 'phase') {
      setUi({phase: e.phase});
    }
  }, []);

  const clearAutoRearmTimer = useCallback(() => {
    if (autoRearmTimer.current) {
      clearTimeout(autoRearmTimer.current);
      autoRearmTimer.current = null;
    }
  }, []);

  const autoRearm = useCallback(() => {
    clearAutoRearmTimer();
    // Auto-rearm after a brief pause to show the done state
    autoRearmTimer.current = setTimeout(() => {
      setDone(null);
      autoRearmTimer.current = null;
    }, 2600);
  }, [clearAutoRearmTimer]);

  async function run(state: DemoStateId, replace: boolean) {
    setBusy(true);
    setRunArmed(true);
    setStop(null);
    setDone(null);
    setPlaceholderNote(false);
    clearAutoRearmTimer();
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
      // ENG-740: a demo success records locally (pending stays false); a real
      // success posts its registry row through the store's outbox — on
      // failure the row is pending and the retry passes carry it.
      if (app.demo) {
        app.addDemoRecord({
          id,
          ok: true,
          demo: state,
          at: Date.now(),
          pending: false,
        });
      } else {
        // ENG-741 wires the real batch id and escrow ordinal; until then the
        // placeholder constants must not reach the service — with foreign
        // keys on, a batch_id no batch row holds is a 500 and an eternally
        // pending row. The run records locally and the done panel says the
        // record is held, visibly, rather than posting a doomed row.
        if (PLACEHOLDER_BATCH_ID === 0 || PLACEHOLDER_ORDINAL === 0) {
          app.addRecord({
            id,
            ok: true,
            at: Date.now(),
            pending: false,
          });
          setPlaceholderNote(true);
        } else {
          setPlaceholderNote(false);
          app.postRegistryCard({
            short_id: id,
            batch_id: PLACEHOLDER_BATCH_ID,
            key_id: 2,
            ordinal: PLACEHOLDER_ORDINAL,
            installed_at: Date.now(),
            installer: 'op@bench',
            load_sha256: 'fe7d8ac3',
          });
        }
      }
      // ENG-754: auto-rearm after done - brief pause then auto-rearm
      autoRearm();
    } else {
      const cont = (stopId === 'hasOld' || stopId === 'oldVersion') && !replace;
      setStop({id: stopId, cont});
      if (stopId === 'wrongKeys') {
        setNeedsAck(true);
      }
      if (app.demo) {
        app.addDemoRecord({
          id: state,
          ok: false,
          demo: state,
          at: Date.now(),
          pending: false,
        });
      } else {
        // A real stop is a real stop: no `demo` field, or the summary's
        // `(demo: wrongKeys)` mislabels the operator's batch record (only
        // genuine demo rows carry it).
        app.addRecord({
          id: state,
          ok: false,
          at: Date.now(),
          pending: false,
        });
      }
    }
    setUi({phase: ''});
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAutoRearmTimer();
    };
  }, [clearAutoRearmTimer]);

  const runningPhase =
    ui.phase === 'load' && ui.block
      ? `Writing ${Math.round((ui.block.index / ui.block.of) * 100)}%`
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

  const doneCount = batch.done.filter(r => r.ok).length;
  const batchProgress = batch.count > 0 ? doneCount / batch.count : 0;

  const center = (() => {
    if (busy || done || stop) {
      return null; // the run panel below carries it
    }
    if (app.demo) {
      return (
        <View style={s.panel}>
          {DEMO_STATES.map((d, i) => (
            <Fragment key={d.id}>
              {i > 0 ? <View style={s.panelDivider} /> : null}
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
            </Fragment>
          ))}
        </View>
      );
    }
    return (
      <View style={s.realOff}>
        <PrimaryButton
          title={LOOP.program}
          disabled
          onPress={() => undefined}
        />
        <Dim>
          {'Runs against real cards arrive with the key service (Phase 3).'}
        </Dim>
      </View>
    );
  })();

  return (
    <Screen title={app.demo ? 'Demo batch' : 'Batch'}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.head}>
          <Text testID="counter" style={s.counter}>
            {LOOP.of(doneCount, batch.count)}
          </Text>
          <View style={s.progress} testID="batch-progress">
            <View
              style={[
                s.progressFill,
                {width: `${Math.round(batchProgress * 100)}%`},
              ]}
            />
          </View>
        </View>

        <View style={s.figureWrap}>
          <CardFigure fill={fill} state={figureState} />
        </View>

        <Text testID="phase-line" style={busy ? s.phase : s.idleLine}>
          {busy ? runningPhase : done || stop ? ' ' : LOOP.idle}
        </Text>

        {done ? (
          <View style={[s.result, s.resultDone]} testID="done">
            <Text style={s.resultTitle}>{LOOP.doneTitle}</Text>
            <Text style={s.resultId}>{LOOP.done(done.id)}</Text>
            {done.pin ? (
              <View style={s.pinBlock}>
                <Text style={s.resultPinLabel}>PIN</Text>
                <Text testID="pin-line" style={s.resultPin}>
                  {done.pin}
                </Text>
              </View>
            ) : null}
            {placeholderNote && !app.demo ? (
              <Text testID="placeholder-note" style={s.resultLine}>
                {LOOP.placeholderRecord}
              </Text>
            ) : null}
            {/* ENG-754: auto-rearm - no button needed, auto-rearms after pause */}
          </View>
        ) : null}

        {stop ? (
          <View
            testID="stop"
            style={[s.result, STOP[stop.id].danger ? s.resultDanger : null]}>
            <Text
              style={[
                s.resultTitle,
                STOP[stop.id].danger ? s.resultTitleDanger : null,
              ]}>
              {STOP[stop.id].what}
            </Text>
            <Text style={s.resultLine}>{STOP[stop.id].card}</Text>
            <Text style={s.resultNext}>{STOP[stop.id].next}</Text>
            {STOP[stop.id].action ? (
              <View style={s.resultAction}>
                <PrimaryButton
                  title={STOP[stop.id].action!}
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
            ) : (
              <View style={s.resultAction}>
                <PrimaryButton
                  title="OK"
                  testID="stop-ok"
                  onPress={() => {
                    setStop(null);
                    setNeedsAck(false);
                  }}
                />
              </View>
            )}
          </View>
        ) : null}

        {center}

        <View style={s.footer}>
          {/* ENG-756: in-tap Cancel while run is armed */}
          {runArmed ? (
            <SecondaryButton
              title="CANCEL"
              testID="cancel-run"
              onPress={() => {
                setBusy(false);
                setRunArmed(false);
                clearAutoRearmTimer();
                setUi({phase: ''});
              }}
            />
          ) : null}
          <SecondaryButton title="END BATCH" onPress={onEndBatch} />
        </View>
      </ScrollView>
    </Screen>
  );
}
