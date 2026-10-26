/** Daily operator workspace; opening a tool leaves NFC idle. */
import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import {useProvisioning} from '../ProvisioningStore';
import {useApp} from '../store';
import {OpsDashboardLink} from '../LegalLinks';
import {FONT, useTheme} from '../theme';
import {
  Dim,
  GearButton,
  HelpHeading,
  InfoButton,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../ui';

function CardTool({
  kind,
  title,
  detail,
  disabled,
  onPress,
}: {
  kind: 'check' | 'reset';
  title: string;
  detail?: string;
  disabled: boolean;
  onPress(): void;
}) {
  const t = useTheme();
  const s = StyleSheet.create({
    row: {
      backgroundColor: t.card,
      borderRadius: 16,
      padding: 18,
      minHeight: 88,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    muted: {opacity: 0.55},
    text: {flex: 1, gap: 5},
    title: {fontFamily: FONT.semibold, fontSize: 20, color: t.ink},
    detail: {fontFamily: FONT.regular, fontSize: 15, color: t.dim},
    arrow: {fontFamily: FONT.regular, fontSize: 26, color: t.dim},
  });
  return (
    <Pressable
      testID={`home-${kind}`}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [s.row, (disabled || pressed) && s.muted]}>
      <Svg width={32} height={32} viewBox="0 0 32 32" accessible={false}>
        <Rect
          x={2}
          y={5}
          width={28}
          height={22}
          rx={5}
          fill="none"
          stroke={t.accent}
          strokeWidth={1.8}
        />
        {kind === 'check' ? (
          <Path
            d="m10 16 4 4 8-8"
            fill="none"
            stroke={t.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <Path
            d="M11 14a6 6 0 1 1 0 6M11 10v4h4"
            fill="none"
            stroke={t.accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
      <View style={s.text}>
        <Text style={s.title}>{title}</Text>
        {detail ? <Text style={s.detail}>{detail}</Text> : null}
      </View>
      <Text accessible={false} style={s.arrow}>
        ›
      </Text>
    </Pressable>
  );
}

export function CardsHomeScreen({
  onInstall,
  onCheck,
  onReset,
  onSettings,
}: {
  onInstall(): void;
  onCheck(): void;
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
  const toolsDisabled =
    flow.busy || flow.status !== 'ready' || !flow.scopeMatches;
  const resetDisabled =
    toolsDisabled || !!batch || pendingReset || !flow.hardwareValidated;
  const resetDetail = batch
    ? 'Finish or end the current batch first.'
    : pendingReset
    ? 'Continue the saved reset above.'
    : !flow.hardwareValidated
    ? 'Reset is unavailable in this build.'
    : undefined;
  const connectionOrigin = /^https?:\/\/[^\s/?#@]+\/?$/.test(app.serviceUrl)
    ? app.serviceUrl
    : 'Configured service';
  React.useEffect(() => {
    setConfirmEnd(false);
  }, [batch?.request.batch_request_id, batch?.next_ordinal]);
  const s = StyleSheet.create({
    scroll: {gap: 20, paddingBottom: 24},
    card: {backgroundColor: t.card, borderRadius: 16, padding: 20, gap: 16},
    heading: {fontFamily: FONT.semibold, fontSize: 25, color: t.ink},
    account: {paddingVertical: 8, minHeight: 52, gap: 4},
    accountRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    accountAction: {minHeight: 44},
    operator: {
      fontFamily: FONT.medium,
      fontSize: 17,
      color: t.ink,
      flexShrink: 1,
    },
    service: {fontFamily: FONT.regular, fontSize: 14, color: t.dim},
    tools: {gap: 12},
    label: {fontFamily: FONT.medium, fontSize: 17, color: t.dim},
  });
  return (
    <Screen
      title="Cards"
      onStop={flow.busy ? flow.cancel : undefined}
      headerRight={<GearButton testID="settings" onPress={onSettings} />}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.account}>
          <Pressable
            testID="home-settings"
            accessibilityRole="button"
            accessibilityLabel="Account and settings"
            onPress={onSettings}
            style={[s.accountRow, s.accountAction]}>
            <Text style={s.service}>Signed in as</Text>
            <Text testID="home-operator" style={s.operator}>
              {app.operatorName || `Operator #${app.session?.operator_id}`}
            </Text>
          </Pressable>
          <View style={s.accountRow}>
            <OpsDashboardLink
              testID="home-dashboard"
              textTestID="home-service"
            />
            <InfoButton title="Account and service" testID="home-account-help">
              {`The name above is your signed-in operator account. Manage operators, batches and card records in the ops dashboard.\n\nAPI connection: ${connectionOrigin}\n\nSaved work stays bound to its original API connection and operator account.`}
            </InfoButton>
          </View>
        </View>
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
            <Text style={s.heading}>
              {batch.next_ordinal === batch.request.count
                ? 'Batch finished'
                : 'Batch in progress'}
            </Text>
            <Dim>
              {batch.next_ordinal} of {batch.request.count} attempts finished
            </Dim>
            <Dim>{`Batch #${batch.batch_id} · ${batch.request.mint_url}`}</Dim>
            <PrimaryButton
              title={
                batch.next_ordinal === batch.request.count
                  ? 'VIEW BATCH RESULTS'
                  : 'CONTINUE BATCH'
              }
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
            <HelpHeading
              title="New batch"
              titleStyle={s.heading}
              testID="home-batch-help">
              {
                'Install card software and save the result. Card holders finish ownership and PIN setup in their wallet.'
              }
            </HelpHeading>
            <PrimaryButton
              title="NEW BATCH"
              testID="home-new"
              disabled={flow.busy || !flow.hardwareValidated}
              onPress={onInstall}
            />
            {!flow.hardwareValidated ? (
              <Dim>Card installation is unavailable in this build.</Dim>
            ) : null}
          </View>
        )}
        {flow.notice && flow.status === 'ready' ? (
          <Dim>{flow.notice}</Dim>
        ) : null}
        <View style={s.tools}>
          <HelpHeading
            title="Card tools"
            titleStyle={s.label}
            testID="home-tools-help">
            {
              'Check reads public card status and offers the next step. Reset checks an empty card and asks for approval before removing its old installation. Each tool waits for an explicit read.'
            }
          </HelpHeading>
          <CardTool
            kind="check"
            title="Check a card"
            disabled={toolsDisabled}
            onPress={onCheck}
          />
          <CardTool
            kind="reset"
            title="Reset a card for reuse"
            detail={resetDetail}
            disabled={resetDisabled}
            onPress={onReset}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
