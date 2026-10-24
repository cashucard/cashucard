/** A landing page, not an automatic redirect into durable card work. */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useProvisioning} from '../ProvisioningStore';
import {useApp} from '../store';
import {FONT, useTheme} from '../theme';
import {Dim, GearButton, PrimaryButton, Screen, SecondaryButton} from '../ui';
export function CardsHomeScreen({
  onInstall,
  onReset,
  onSettings,
}: {
  onInstall(): void;
  onReset(): void;
  onSettings(): void;
}) {
  const flow = useProvisioning(),
    app = useApp(),
    t = useTheme();
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  const snapshot = flow.snapshot,
    batch = snapshot?.batch;
  const pendingReset =
    !!flow.resetState && flow.resetState.journal.stage !== 'complete';
  React.useEffect(() => {
    setConfirmEnd(false);
  }, [batch?.request.batch_request_id, batch?.next_ordinal]);
  const s = StyleSheet.create({
    scroll: {gap: 20, paddingBottom: 24},
    card: {backgroundColor: t.card, borderRadius: 16, padding: 20, gap: 16},
    heading: {fontFamily: FONT.semibold, fontSize: 25, color: t.ink},
  });
  return (
    <Screen
      title="Cards"
      headerRight={<GearButton testID="settings" onPress={onSettings} />}>
      <ScrollView contentContainerStyle={s.scroll}>
        {flow.status !== 'ready' ? (
          <View style={s.card}>
            <Text style={s.heading}>
              {flow.status === 'loading'
                ? 'Loading saved work…'
                : 'Saved work needs attention'}
            </Text>
            <Dim>
              {flow.notice ??
                'Card work is paused until saved progress can be loaded.'}
            </Dim>
            {flow.status === 'blocked' ? (
              <SecondaryButton
                title="RELOAD SAVED WORK"
                testID="home-reload"
                onPress={() => {
                  flow.reload();
                }}
              />
            ) : null}
          </View>
        ) : !flow.scopeMatches ? (
          <View style={s.card}>
            <Text style={s.heading}>
              Saved work belongs to another account or service
            </Text>
            <Dim>
              Sign in with the original operator and service to continue this
              work. Nothing has been changed.
            </Dim>
            <PrimaryButton
              title="SWITCH ACCOUNT"
              testID="home-switch-account"
              onPress={app.signOut}
            />
          </View>
        ) : pendingReset ? (
          <View style={s.card}>
            <Text style={s.heading}>Card reset saved</Text>
            <Dim>
              Continue with the same card to check and finish the reset. You can
              leave this screen and return later.
            </Dim>
            <PrimaryButton
              title="CONTINUE CARD RESET"
              testID="home-resume"
              disabled={flow.busy}
              onPress={onReset}
            />
          </View>
        ) : batch ? (
          <View style={s.card}>
            <Text style={s.heading}>Saved batch</Text>
            <Dim>
              {batch.next_ordinal} of {batch.request.count} attempts finished
            </Dim>
            <PrimaryButton
              title="CONTINUE BATCH"
              testID="home-resume"
              disabled={flow.busy}
              onPress={onInstall}
            />
            {snapshot?.active ? (
              <Dim>
                Finish the current attempt or save its stop before ending this
                batch. No card session starts until you choose it.
              </Dim>
            ) : batch.next_ordinal === batch.request.count ? (
              <SecondaryButton
                title="CLOSE FINISHED BATCH"
                testID="home-close"
                disabled={flow.busy}
                onPress={() => {
                  flow.close();
                }}
              />
            ) : batch.ending ? (
              <SecondaryButton
                title="RETRY ENDING BATCH"
                testID="home-end-retry"
                disabled={flow.busy}
                onPress={() => {
                  flow.recover();
                }}
              />
            ) : confirmEnd ? (
              <>
                <Dim>
                  End this batch and release its{' '}
                  {batch.request.count - batch.next_ordinal} unused places?
                  Finished and stopped attempts stay in the service history.
                  Wait for confirmation before starting another batch.
                </Dim>
                <PrimaryButton
                  title="END BATCH"
                  testID="home-end-confirm"
                  disabled={flow.busy}
                  onPress={() => {
                    setConfirmEnd(false);
                    flow.end();
                  }}
                />
                <SecondaryButton
                  title="KEEP BATCH"
                  testID="home-end-cancel"
                  onPress={() => setConfirmEnd(false)}
                />
              </>
            ) : (
              <SecondaryButton
                title="END BATCH"
                testID="home-end"
                disabled={flow.busy}
                onPress={() => setConfirmEnd(true)}
              />
            )}
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.heading}>Ready for a new batch</Text>
            <Dim>
              Install card software here. Card holders finish ownership and PIN
              setup in their wallet.
            </Dim>
            <PrimaryButton
              title="NEW BATCH"
              testID="home-new"
              disabled={flow.busy || !flow.hardwareValidated}
              onPress={onInstall}
            />
          </View>
        )}
        {flow.notice && flow.status === 'ready' ? (
          <Dim>{flow.notice}</Dim>
        ) : null}
        <Dim>
          Each operator’s saved work stays on this phone. Sign in with the same
          account and service to return to it.
        </Dim>
        <SecondaryButton
          title="SETTINGS AND CARD TOOLS"
          testID="home-settings"
          onPress={onSettings}
        />
      </ScrollView>
    </Screen>
  );
}
