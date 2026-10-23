/** Real receipts and recovery controls; demo results never enter this screen. */
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
  'Card installation is paused until device validation is complete. Personalization is not available in this build.';
const STAGES: Record<string, string> = {
  reserved: 'Card reserved. No installation has been confirmed.',
  install_intent:
    'An installation was interrupted. The same card must be checked before continuing.',
  installed: 'Installation verified. Key rotation is not yet confirmed.',
  rotation_intent:
    'Key rotation was interrupted. The same card must be checked before continuing.',
  rotated:
    'Key rotation verified. The installation record has not been sent yet.',
  record_pending:
    'Installation and key rotation verified. The record is awaiting the service.',
  recorded:
    'The service confirmed the installation record. Batch progress is awaiting confirmation.',
  quarantined:
    'This attempt is stopped. Its evidence is retained for your operator.',
};
const STOP_REASONS: Record<string, string> = {
  'identity-mismatch': 'Card identity did not match the saved attempt.',
  'authentication-failed': 'Card manager authentication failed.',
  'unsafe-partial-install':
    'Installation stopped after an uncertain card change.',
  'verification-failed': 'Card verification failed.',
  'reconciliation-required': 'Operator reconciliation is required.',
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
              ? 'Installation and rotation recorded. Holder wallet setup required before use.'
              : `Stopped and acknowledged. ${
                  STOP_REASONS[j.quarantine_reason ?? ''] ??
                  'Operator review required.'
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
}: {
  onSettings: () => void;
  onReset?: () => void;
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
  const shell = (content: React.ReactNode) => (
    <Screen
      title="Card installation"
      headerRight={<GearButton testID="settings" onPress={onSettings} />}>
      <ScrollView contentContainerStyle={s.scroll}>{content}</ScrollView>
      {flow.cardActive ? (
        <View style={s.stickyAction} testID="sticky-card-action">
          <SecondaryButton
            title="CANCEL TAP"
            testID="real-cancel"
            onPress={flow.cancel}
          />
        </View>
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
          Continue with the same card before starting another installation.
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
          onSettings={onSettings}
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
    `Installation record — ${recorded.length} rotation records, ${stopped} stops\n` +
    'No holder readiness is certified.\n' +
    snapshot.history
      .map(
        j =>
          `Card ${j.ordinal + 1}${
            j.installation_id ? ` …${j.installation_id.slice(-4)}` : ''
          }: ` +
          (j.stage === 'recorded'
            ? 'installation and rotation recorded'
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
            before terminating the app. No holder readiness is certified.
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
        {batch.next_ordinal} of {batch.request.count} attempts acknowledged
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
        {recorded.length} rotation records · {stopped} stops
      </Dim>
      <Dim>
        Installation and key rotation only. These cards are not ready for
        holders.
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
            title={pendingRecord ? 'RETRY RECORD' : 'SYNC SAVED WORK'}
            testID="recovery-retry"
            disabled={flow.busy}
            onPress={() => {
              flow.recover();
            }}
          />
          {stage === 'quarantined' ? (
            <PrimaryButton
              title="ACKNOWLEDGE STOP AND CONTINUE"
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
        <Dim>Resolve and acknowledge this attempt before ending the batch.</Dim>
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
            Stop this unused attempt, acknowledge the stop and close the batch.
            Then open Settings → Reset a card.
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
              The attempt will remain stopped across restarts. A bound card
              stays blocked until your operator resolves it.
            </Dim>
          ) : null}
        </>
      ) : null}
      <BatchHistory history={snapshot.history} />
      {snapshot.history.length ? (
        <SecondaryButton
          title="SHARE INSTALLATION RECORD"
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
        title="EXPORT RECOVERY DETAILS"
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
          title="CLOSE ACKNOWLEDGED BATCH"
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
              <Text style={s.line}>Batch closure is awaiting the service.</Text>
              <Dim>
                The saved decision and all attempt records remain on this phone.
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
                Existing attempts stay in the service record. The unused slots
                cannot be reserved later.
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
                title="KEEP BATCH"
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
          title="SYNC SAVED WORK"
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
