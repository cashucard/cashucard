/**
 * S5. Settings, grouped the way a 2026 settings screen is grouped: section
 * headers, one card per group, hairline dividers,
 * the account scope as a read-only row, and signed-in card tools.
 *
 * The batch-setup revamp's rules hold here too: tabular figures for every
 * number and button semantics
 * for interactive rows.
 */
import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import {SETTINGS} from '../strings';
import appInfo from '../../package.json';
import {CASHU_LOAD_FILE} from '../assets/cashu';
import {useApp} from '../store';
import {LegalLinks, OpsDashboardLink} from '../LegalLinks';
import {BENCH_RUNS_ENABLED} from '../releaseGates';
import {FONT, useTheme, type Theme} from '../theme';
import {HelpHeading, Screen, SecondaryButton} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    scroll: {gap: 22, paddingBottom: 32},
    section: {gap: 8},
    header: {
      color: t.dim,
      fontFamily: FONT.semibold,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: t.card,
      borderRadius: 16,
      overflow: 'hidden',
    },
    row: {
      paddingHorizontal: 18,
      paddingVertical: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 52,
    },
    divider: {height: StyleSheet.hairlineWidth, backgroundColor: t.line},
    rowLabel: {flex: 1, color: t.ink, fontFamily: FONT.medium, fontSize: 16},
    rowSub: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      marginTop: 2,
    },
    rowValue: {
      color: t.dim,
      fontFamily: FONT.tabular,
      fontVariant: ['tabular-nums'],
      fontSize: 15,
    },
    note: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 13,
      lineHeight: 19,
    },
    chevron: {color: t.dim, fontFamily: FONT.regular, fontSize: 22},
    // The identity block: wordmark-size version, the load sha as the small print
    // under it, both centered: the same "which build am I holding" posture the
    // batch screen's footer line keeps.
    identity: {
      alignItems: 'center',
      paddingVertical: 20,
      gap: 4,
    },
    version: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 17,
      fontVariant: ['tabular-nums'],
    },
    loadSha: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    rowLabelCol: {flex: 1},
    confirmBlock: {padding: 18, gap: 10},
  });

export function SettingsScreen({
  onBack,
  onBench,
  onIdentity,
  onReset,
  onStatus,
  onChangeService,
  hardwareBusy = false,
  hasSavedBatch = false,
}: {
  onBack: () => void;
  onBench: () => void;
  onIdentity?: () => void;
  onReset?: () => void;
  onStatus?: () => void;
  onChangeService?: () => void;
  hardwareBusy?: boolean;
  hasSavedBatch?: boolean;
}) {
  const app = useApp();
  const [confirmSignOut, setConfirmSignOut] = React.useState<
    'sign-out' | 'service' | null
  >(null);
  const t = useTheme();
  const s = local(t);
  const env = app.session?.env;
  const scopeLabel =
    env === 'issued'
      ? SETTINGS.issued
      : env === 'factory'
      ? SETTINGS.factory
      : SETTINGS.scopeSignedOut;
  return (
    <Screen title={SETTINGS.title} onBack={onBack}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.section}>
          <HelpHeading
            title={SETTINGS.provisioningScope}
            titleStyle={s.header}
            testID="provisioning-scope-help"
            accessibilityLabel={SETTINGS.scopeHelpLabel}
            bodyTestID="provisioning-scope-explanation">
            {`${SETTINGS.scopeAssigned} ${SETTINGS.scopeExplanation}`}
          </HelpHeading>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{SETTINGS.accountScope}</Text>
              <Text style={s.rowValue} testID="provisioning-scope-value">
                {scopeLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <HelpHeading
            title="Card tools"
            titleStyle={s.header}
            testID="settings-tools-help">
            {
              'Check reads public card status. Identity reads the chip’s CPLC identifier. Reset checks value, settlement and manager-key records before asking for erasure approval.'
            }
          </HelpHeading>
          <View style={s.card}>
            {onStatus ? (
              <Pressable
                testID="card-status-entry"
                accessibilityRole="button"
                onPress={onStatus}
                disabled={hardwareBusy}
                style={s.row}>
                <View style={s.rowLabelCol}>
                  <Text style={s.rowLabel}>Check a card</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ) : null}
            {onIdentity ? (
              <>
                <Pressable
                  testID="identity-entry"
                  onPress={onIdentity}
                  disabled={hardwareBusy}
                  style={s.row}>
                  <View style={s.rowLabelCol}>
                    <Text style={s.rowLabel}>Read physical card identity</Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <View style={s.divider} />
              </>
            ) : null}
            {onReset ? (
              <Pressable
                testID="reset-entry"
                accessibilityRole="button"
                onPress={onReset}
                disabled={hardwareBusy}
                style={s.row}>
                <View style={s.rowLabelCol}>
                  <Text style={s.rowLabel}>Reset a card for reuse</Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ) : null}
            {BENCH_RUNS_ENABLED ? (
              <Pressable
                testID="bench-entry"
                onPress={onBench}
                disabled={hardwareBusy}
                style={s.row}>
                <View style={s.rowLabelCol}>
                  <Text style={s.rowLabel}>{SETTINGS.bench}</Text>
                  <Text style={s.rowSub}>
                    {'Load test against the spare card. Bench only.'}
                  </Text>
                </View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={s.section}>
          <HelpHeading
            title={SETTINGS.session}
            titleStyle={s.header}
            testID="settings-session-help">
            {SETTINGS.signOutSub}
          </HelpHeading>
          <View style={s.card}>
            {onChangeService ? (
              <>
                <Pressable
                  testID="settings-change-service"
                  style={s.row}
                  accessibilityRole="button"
                  disabled={hardwareBusy}
                  accessibilityState={{disabled: hardwareBusy}}
                  onPress={() =>
                    hasSavedBatch
                      ? setConfirmSignOut('service')
                      : onChangeService()
                  }>
                  <Text style={s.rowLabel}>Change ops service</Text>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <View style={s.divider} />
              </>
            ) : null}
            <Pressable
              testID="sign-out"
              onPress={() => {
                if (hasSavedBatch) {
                  setConfirmSignOut('sign-out');
                } else {
                  app.signOut();
                }
              }}
              style={s.row}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowLabel}>{SETTINGS.signOut}</Text>
              </View>
            </Pressable>
            {confirmSignOut ? (
              <View style={s.confirmBlock}>
                <Text style={s.rowLabel}>Saved work on this phone</Text>
                <Text style={s.note}>
                  Signing out stops any current card session. Sign in with the
                  same operator and service to continue saved work.
                </Text>
                <SecondaryButton
                  title={
                    confirmSignOut === 'service'
                      ? 'SIGN OUT AND CHOOSE SERVICE'
                      : 'SIGN OUT AND KEEP SAVED WORK'
                  }
                  testID="confirm-sign-out"
                  onPress={() =>
                    confirmSignOut === 'service'
                      ? onChangeService?.()
                      : app.signOut()
                  }
                />
                <SecondaryButton
                  title="KEEP SESSION"
                  testID="keep-session"
                  onPress={() => setConfirmSignOut(null)}
                />
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.section}>
          <HelpHeading
            title={SETTINGS.about}
            titleStyle={s.header}
            testID="settings-build-help">
            {`Load file: ${CASHU_LOAD_FILE.sha256}\n\nCAP: ${CASHU_LOAD_FILE.capSha256}\n\nThese fingerprints identify the card software included in this build.`}
          </HelpHeading>
          <View style={s.card}>
            <View style={s.identity}>
              <Text style={s.version}>
                {SETTINGS.version(
                  `${appInfo.version} (${appInfo.provisionerBuild})`,
                )}
              </Text>
              <Text style={s.loadSha}>
                {SETTINGS.loadSha(CASHU_LOAD_FILE.sha256.slice(0, 8))}
              </Text>
              <OpsDashboardLink testID="settings-dashboard" />
            </View>
          </View>
        </View>
        <LegalLinks />
      </ScrollView>
    </Screen>
  );
}
