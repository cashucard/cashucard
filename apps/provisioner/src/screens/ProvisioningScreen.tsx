/** Durable installation receipts and recovery controls. */
import React from 'react';
import {ScrollView, Share, StyleSheet, Text, View} from 'react-native';
import {RECOVERY_BOUNDARIES} from '../recoveryDrills';
import {CASHU_PLAN} from '../cardkit';
import {CardFigure} from '../CardFigure';
import {useProvisioning} from '../ProvisioningStore';
import {BatchSetupScreen} from './BatchSetupScreen';
import {PHASES} from '../strings';
import {recoveryDetails} from '../recoveryExport';
import type {AttemptJournal} from '../journal';
import {FONT, useTheme} from '../theme';
import {Dim, GearButton, PrimaryButton, Screen, SecondaryButton} from '../ui';

const GATE =
  'Installation is unavailable in this build. Ask your administrator for an installation-enabled release.';
const STAGES: Record<string, string> = {
  reserved: 'Ready to check this card. Installation has not been confirmed.',
  install_intent:
    'Installation may be incomplete. Continue with this same card to check what finished.',
  installed:
    'Card software is installed. Continue with this card to finish security setup.',
  rotation_intent:
    'Security setup may be incomplete. Continue with this same card to check what finished.',
  rotated:
    'Security setup is verified. Continue with this same card to finish saving the result.',
  record_pending:
    'Card work is complete. Save the result online; no card tap is needed.',
  recorded:
    'Installation saved. Finish updating this batch; no card tap is needed.',
  quarantined:
    'Stopped for review. Keep this card and share support details with your administrator.',
};
const STOP_REASONS: Record<string, string> = {
  'identity-mismatch': 'Card identity did not match the saved attempt.',
  'authentication-failed': 'The expected manager keys did not match this card.',
  'unsafe-partial-install':
    'The installation could not be confirmed after an interruption.',
  'verification-failed': 'Card checks could not confirm the expected state.',
  'reconciliation-required':
    'Administrator review is needed before another installation.',
};
const HISTORY_PAGE_SIZE = 20;

/** Bounded pages keep old or unusually large batches from mounting every row. */
export function BatchHistory({
  history,
}: {
  history: ReadonlyArray<
    Pick<
      AttemptJournal,
      | 'ordinal'
      | 'attempt_id'
      | 'stage'
      | 'installation_id'
      | 'chip_id'
      | 'quarantine_reason'
    >
  >;
}) {
  const t = useTheme();
  const [olderPages, setOlderPages] = React.useState(0);
  const maxPage = Math.max(
    0,
    Math.ceil(history.length / HISTORY_PAGE_SIZE) - 1,
  );
  const page = Math.min(olderPages, maxPage);
  const end = history.length - page * HISTORY_PAGE_SIZE;
  const start = Math.max(0, end - HISTORY_PAGE_SIZE);
  const rows = history.slice(start, end);
  const s = StyleSheet.create({
    wrap: {gap: 12},
    card: {backgroundColor: t.card, padding: 16, borderRadius: 16, gap: 10},
    line: {color: t.ink, fontFamily: FONT.regular, fontSize: 16},
  });
  return (
    <View style={s.wrap}>
      {rows.map(j => (
        <View key={j.attempt_id} style={s.card} testID="history-row">
          <Text style={s.line}>
            {`Card ${j.ordinal + 1}${
              j.installation_id ? ` …${j.installation_id.slice(-4)}` : ''
            }`}
          </Text>
          <Dim>
            {j.stage === 'recorded'
              ? 'Installation saved. Set up this card in a holder wallet before loading or spending.'
              : `Stopped and saved. ${
                  STOP_REASONS[j.quarantine_reason ?? ''] ??
                  'Administrator review needed.'
                }`}
          </Dim>
          <Dim>{`Attempt …${j.attempt_id.slice(-6)}${
            j.chip_id ? ` · Chip …${j.chip_id.slice(-8)}` : ''
          }`}</Dim>
        </View>
      ))}
      {history.length > HISTORY_PAGE_SIZE ? (
        <Dim>{`Showing attempts ${start + 1}–${end} of ${history.length}`}</Dim>
      ) : null}
      {page < maxPage ? (
        <SecondaryButton
          title="OLDER ATTEMPTS"
          testID="history-older"
          onPress={() => setOlderPages(value => value + 1)}
        />
      ) : null}
      {page > 0 ? (
        <SecondaryButton
          title="NEWER ATTEMPTS"
          testID="history-newer"
          onPress={() => setOlderPages(value => value - 1)}
        />
      ) : null}
    </View>
  );
}
export function ProvisioningScreen({
  onSettings,
  onReset,
  onCheck,
}: {
  onSettings: () => void;
  onReset?: () => void;
  onCheck?: () => void;
}) {
  const flow = useProvisioning();
  const t = useTheme();
  const [confirmQuarantine, setConfirmQuarantine] = React.useState(false);
  const [confirmEndBatch, setConfirmEndBatch] = React.useState(false);
  React.useEffect(() => {
    setConfirmQuarantine(false);
  }, [flow.snapshot?.active?.attempt_id, flow.scopeMatches]);
  React.useEffect(() => {
    setConfirmEndBatch(false);
  }, [flow.snapshot?.active?.attempt_id, flow.snapshot?.batch?.next_ordinal]);
  const [shareNote, setShareNote] = React.useState(false);
  const [exportFailed, setExportFailed] = React.useState(false);
  const s = StyleSheet.create({
    grow: {flex: 1},
    scroll: {gap: 18, paddingBottom: 24},
    title: {color: t.ink, fontFamily: FONT.semibold, fontSize: 24},
    line: {color: t.ink, fontFamily: FONT.regular, fontSize: 16},
    card: {backgroundColor: t.card, padding: 16, borderRadius: 16, gap: 10},
    batchTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: t.line,
      overflow: 'hidden',
    },
    batchFill: {height: '100%', backgroundColor: t.accent},
    figure: {alignItems: 'center', gap: 12, paddingVertical: 8},
    phase: {
      color: t.ink,
      fontFamily: FONT.medium,
      fontSize: 17,
      textAlign: 'center',
      minHeight: 24,
    },
    stickyAction: {paddingTop: 10, paddingBottom: 8, backgroundColor: t.bg},
  });
  const leave = () => {
    if (flow.busy) {
      flow.cancel();
    }
    onSettings();
  };
  const pauseAndLeave = () => {
    flow.cancel();
    onSettings();
  };
  const shell = (content: React.ReactNode) => (
    <Screen
      title={
        flow.resetState && flow.resetState.journal.stage !== 'complete'
          ? 'Saved card reset'
          : 'Card installation'
      }
      onStop={flow.busy ? flow.cancel : undefined}
      headerRight={<GearButton testID="settings" onPress={leave} />}>
      <ScrollView contentContainerStyle={s.scroll}>{content}</ScrollView>
      {flow.busy ? (
        <View style={s.stickyAction} testID="sticky-card-action">
          <SecondaryButton
            title={flow.cardActive ? 'CANCEL TAP' : 'STOP AND KEEP SAVED WORK'}
            testID="real-cancel"
            onPress={flow.cancel}
          />
        </View>
      ) : flow.snapshot?.batch || flow.resetState || flow.status !== 'ready' ? (
        <SecondaryButton
          title="STOP FOR NOW"
          testID={
            flow.resetState && flow.resetState.journal.stage !== 'complete'
              ? 'reset-stop-for-now'
              : 'work-stop-for-now'
          }
          onPress={pauseAndLeave}
        />
      ) : null}
    </Screen>
  );
  if (flow.status === 'loading') {
    return shell(
      <Text style={s.line} testID="recovery-loading">
        Checking saved work…
      </Text>,
    );
  }
  if (flow.status === 'blocked') {
    return shell(
      <>
        <Text style={s.title}>Saved work is paused</Text>
        <Dim>{flow.notice}</Dim>
        <PrimaryButton
          title="RELOAD SAVED WORK"
          testID="recovery-reload"
          disabled={flow.busy}
          onPress={() => {
            flow.reload();
          }}
        />
      </>,
    );
  }
  if (!flow.scopeMatches) {
    return shell(
      <>
        <Text style={s.title} testID="recovery-scope">
          Saved work belongs to another account or service
        </Text>
        <Dim>
          Sign in with the original operator account and service to continue.
          The saved batch has not been changed.
        </Dim>
        {flow.snapshot?.batch ? (
          <Dim>{`Operator #${flow.snapshot.batch.scope.operator_id} · ${flow.snapshot.batch.scope.service_origin}`}</Dim>
        ) : null}
        <SecondaryButton title="SETTINGS" onPress={onSettings} />
      </>,
    );
  }
  const snapshot = flow.snapshot!;
  if (flow.resetState && flow.resetState.journal.stage !== 'complete') {
    return shell(
      <>
        <Text style={s.title}>A card reset is saved on this phone</Text>
        <Dim>
          You can stop and return later. Keep this card aside and use the same
          account and service to continue.
        </Dim>
        <PrimaryButton
          title="CONTINUE CARD RESET"
          testID="open-saved-reset"
          onPress={onReset ?? onSettings}
          disabled={flow.busy}
        />
      </>,
    );
  }
  if (!snapshot.batch) {
    return (
      <View style={s.grow}>
        {onCheck ? (
          <SecondaryButton
            title="CHECK AN EXISTING CARD"
            testID="open-card-status"
            onPress={onCheck}
            disabled={flow.busy}
          />
        ) : null}
        {!flow.hardwareValidated ? (
          <View style={s.card}>
            <Dim>{GATE}</Dim>
          </View>
        ) : null}
        {flow.notice ? (
          <Text style={s.line} testID="recovery-notice">
            {flow.notice}
          </Text>
        ) : null}
        <BatchSetupScreen
          onStart={() => undefined}
          onSettings={leave}
          onStop={flow.cancel}
          onCreate={flow.create}
          canStart={flow.hardwareValidated && !flow.busy}
          installationOnly
          loadSha256={CASHU_PLAN.loadFile.sha256}
        />
      </View>
    );
  }
  const batch = snapshot.batch;
  const ending = batch.ending === true;
  const journal = snapshot.active?.journal;
  const stage = journal?.stage;
  const recorded = snapshot.history.filter(j => j.stage === 'recorded');
  const stopped = snapshot.history.length - recorded.length;
  const complete =
    !snapshot.active && batch.next_ordinal === batch.request.count;
  const pendingRecord = stage === 'record_pending' || stage === 'recorded';
  const lastHistory = snapshot.history[snapshot.history.length - 1];
  const loadFraction = flow.loadProgress
    ? flow.loadProgress.index / flow.loadProgress.of
    : 0;
  const loadPercent = Math.round(loadFraction * 100);
  const loadVerified = [
    'installed',
    'rotation_intent',
    'rotated',
    'record_pending',
    'recorded',
  ].includes(stage ?? '');
  const recentlyRecorded =
    !snapshot.active && lastHistory?.stage === 'recorded';
  const figureFill = loadVerified || recentlyRecorded ? 1 : loadFraction;
  const figureState = flow.busy
    ? 'running'
    : stage === 'quarantined'
    ? 'danger'
    : recentlyRecorded || stage === 'recorded'
    ? 'done'
    : snapshot.active && (flow.notice || stage !== 'reserved')
    ? 'stop'
    : 'idle';
  const canQuarantine =
    !!stage && !['record_pending', 'recorded', 'quarantined'].includes(stage);
  const share =
    `Installation record — ${recorded.length} installed, ${stopped} stopped\n` +
    'Holder-wallet setup is a separate step.\n' +
    snapshot.history
      .map(
        j =>
          `Card ${j.ordinal + 1}${
            j.installation_id ? ` …${j.installation_id.slice(-4)}` : ''
          }: ` +
          (j.stage === 'recorded'
            ? 'installation saved'
            : j.disposition_intent?.kind ?? 'stopped'),
      )
      .join('\n');
  return shell(
    <>
      {flow.drill ? (
        <View style={s.card} testID="recovery-drill-panel">
          <Text style={s.line}>LOCAL VALIDATION BUILD — recovery drill</Text>
          <Dim>
            Pauses are held in memory only. Record the boundary and saved stage
            before terminating the app. Holder-wallet setup is a separate step.
          </Dim>
          {flow.drill.paused ? (
            <>
              <Text selectable style={s.line} testID="recovery-drill-paused">
                {flow.drill.paused}
              </Text>
              <Dim>Saved stage: {stage ?? 'unconfirmed reservation'}</Dim>
              <SecondaryButton
                title="CONTINUE DRILL"
                testID="recovery-drill-resume"
                onPress={flow.drill.resume}
              />
              <SecondaryButton
                title="STOP THIS RUN"
                testID="recovery-drill-stop"
                onPress={flow.drill.stop}
              />
            </>
          ) : (
            <>
              <Dim>{flow.drill.target ?? 'No pause armed'}</Dim>
              {RECOVERY_BOUNDARIES.map(boundary => (
                <SecondaryButton
                  key={boundary}
                  title={boundary}
                  testID={`drill-arm-${boundary}`}
                  disabled={flow.busy || !flow.hardwareValidated}
                  onPress={() => flow.drill!.arm(boundary)}
                />
              ))}
              <SecondaryButton
                title="DISARM PAUSE"
                disabled={flow.busy}
                onPress={() => flow.drill!.arm(null)}
              />
            </>
          )}
        </View>
      ) : null}
      <Text style={s.title} testID="real-progress">
        {batch.next_ordinal} of {batch.request.count} attempts finished
      </Text>
      <View style={s.batchTrack} testID="real-batch-progress">
        <View
          style={[
            s.batchFill,
            {
              width: `${Math.round(
                (batch.next_ordinal / batch.request.count) * 100,
              )}%`,
            },
          ]}
        />
      </View>
      <Dim>
        {recorded.length} installed · {stopped} stopped
      </Dim>
      <Dim>
        Install cards here. Set up ownership and a PIN in a holder wallet before
        loading or spending.
      </Dim>
      <View style={s.figure} testID="real-card-visual">
        <CardFigure fill={figureFill} state={figureState} />
        {flow.busy ? (
          <Text style={s.phase} testID="recovery-busy">
            {flow.phase === 'load'
              ? `Writing ${loadPercent}%`
              : PHASES[flow.phase] ?? 'Confirming saved work…'}
          </Text>
        ) : null}
      </View>
      {flow.notice ? (
        <Text style={s.line} testID="recovery-notice">
          {flow.notice}
        </Text>
      ) : null}
      {snapshot.active ? (
        <View style={s.card} testID="real-attempt">
          <Text style={s.line}>Card {snapshot.active.ordinal + 1}</Text>
          <Text style={s.line}>
            {stage
              ? STAGES[stage]
              : 'The reservation is awaiting confirmation from the service.'}
          </Text>
          {journal?.installation_id ? (
            <Dim>Card …{journal.installation_id.slice(-4)}</Dim>
          ) : null}
          <SecondaryButton
            title={
              pendingRecord ? 'SAVE INSTALLATION RESULT' : 'CHECK SAVED WORK'
            }
            testID="recovery-retry"
            disabled={flow.busy}
            onPress={() => {
              flow.recover();
            }}
          />
          {stage === 'quarantined' ? (
            <PrimaryButton
              title="SAVE STOP AND CONTINUE"
              testID="recovery-acknowledge"
              disabled={flow.busy}
              onPress={() => {
                flow.acknowledge();
              }}
            />
          ) : null}
        </View>
      ) : null}
      {snapshot.active && !complete ? (
        <Dim>Finish or save this stopped attempt before closing the batch.</Dim>
      ) : null}
      {flow.replacement ? (
        <View style={s.card} testID="replacement-review">
          <Text style={s.title}>This card needs reset first</Text>
          <Dim>
            This card already has an applet. No manager authentication or
            installation was attempted. Use Reset a card to check its value and
            current manager keys before replacing it.
          </Dim>
          <Text selectable style={s.line}>
            {flow.replacement.chipId}
          </Text>
          <Text selectable style={s.line}>
            {flow.replacement.installationId}
          </Text>
          <Dim>
            Stop this unused attempt, save the stop and close the batch. Then
            open Settings → Reset a card.
          </Dim>
          <SecondaryButton
            title="KEEP EXISTING INSTALLATION"
            testID="replacement-dismiss"
            disabled={flow.busy}
            onPress={flow.dismissReplacement}
          />
        </View>
      ) : null}
      {!complete &&
      !ending &&
      stage !== 'quarantined' &&
      !pendingRecord &&
      !flow.replacement ? (
        <>
          <PrimaryButton
            title={
              snapshot.active
                ? 'CONTINUE WITH THE SAME CARD'
                : 'INSTALL NEXT CARD'
            }
            testID="real-program"
            disabled={
              flow.busy ||
              !flow.hardwareValidated ||
              (!!snapshot.active && !journal)
            }
            onPress={() => {
              flow.program();
            }}
          />
          {!flow.hardwareValidated ? <Dim>{GATE}</Dim> : null}
        </>
      ) : null}
      {canQuarantine ? (
        <>
          <SecondaryButton
            title={
              confirmQuarantine
                ? 'CONFIRM STOPPING THIS ATTEMPT'
                : 'STOP THIS ATTEMPT'
            }
            testID="recovery-quarantine"
            disabled={flow.busy}
            onPress={() => {
              if (!confirmQuarantine) {
                setConfirmQuarantine(true);
                return;
              }
              setConfirmQuarantine(false);
              flow.quarantine();
            }}
          />
          {confirmQuarantine ? (
            <Dim>
              The stop stays saved after restarting. A card already assigned to
              this attempt needs administrator review before another
              installation.
            </Dim>
          ) : null}
        </>
      ) : null}
      <BatchHistory history={snapshot.history} />
      {snapshot.history.length ? (
        <SecondaryButton
          title="SHARE BATCH RESULTS"
          testID="real-share"
          onPress={() => {
            Share.share({message: share}).catch(() => setShareNote(true));
          }}
        />
      ) : null}
      {shareNote ? (
        <Dim>
          The installation record could not be shared. It remains on this phone.
        </Dim>
      ) : null}
      <SecondaryButton
        title="SHARE SUPPORT DETAILS"
        testID="recovery-export"
        disabled={flow.busy}
        onPress={() => {
          setExportFailed(false);
          Share.share({
            message: JSON.stringify(recoveryDetails(snapshot), null, 2),
          }).catch(() => setExportFailed(true));
        }}
      />
      <Dim>
        Shares public card and attempt identifiers. No keys, PINs or
        credentials.
      </Dim>
      {exportFailed ? (
        <Dim>
          Recovery details could not be shared. Saved work is unchanged.
        </Dim>
      ) : null}
      {complete ? (
        <PrimaryButton
          title="CLOSE BATCH"
          testID="real-close"
          disabled={flow.busy}
          onPress={() => {
            flow.close();
          }}
        />
      ) : null}
      {!snapshot.active && !complete ? (
        <View style={s.card}>
          {ending ? (
            <>
              <Text style={s.line}>
                The service has not confirmed batch closure yet.
              </Text>
              <Dim>
                The request and completed work stay saved on this phone.
              </Dim>
              <SecondaryButton
                title="RETRY ENDING BATCH"
                testID="end-batch-retry"
                disabled={flow.busy}
                onPress={() => {
                  flow.recover();
                }}
              />
            </>
          ) : confirmEndBatch ? (
            <>
              <Text style={s.line}>
                End this batch with {batch.request.count - batch.next_ordinal}{' '}
                unused card slots?
              </Text>
              <Dim>
                Completed and stopped attempts stay in the service history.
                Unused places cannot be used later.
              </Dim>
              <PrimaryButton
                title="END BATCH"
                testID="confirm-end-batch"
                disabled={flow.busy}
                onPress={() => {
                  setConfirmEndBatch(false);
                  flow.end();
                }}
              />
              <SecondaryButton
                title="KEEP WORKING"
                testID="keep-batch"
                onPress={() => setConfirmEndBatch(false)}
              />
            </>
          ) : (
            <SecondaryButton
              title="END BATCH"
              testID="end-batch"
              disabled={flow.busy}
              onPress={() => setConfirmEndBatch(true)}
            />
          )}
        </View>
      ) : null}
      {!snapshot.active && !complete ? (
        <SecondaryButton
          title="CHECK SAVED WORK"
          testID="recovery-retry"
          disabled={flow.busy}
          onPress={() => {
            flow.recover();
          }}
        />
      ) : null}
    </>,
  );
}
