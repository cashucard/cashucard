/** Operator sign-in. Keep the action above the keyboard and the form scrollable. */
import React, {useEffect, useRef, useState} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {ApiCancelledError, ApiUnreachableError} from '../api';
import {CASHU_LOAD_FILE} from '../assets/cashu';
import {APP_NAME, SIGNIN} from '../strings';
import {useApp} from '../store';
import {LegalLinks} from '../LegalLinks';
import {FONT, useTheme, type Theme} from '../theme';
import {InfoButton, PrimaryButton, Screen, SecondaryButton} from '../ui';
import {opsDashboardUrl} from '../LegalLinks';

const local = (t: Theme) =>
  StyleSheet.create({
    grow: {flex: 1},
    center: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 24,
      paddingVertical: 16,
    },
    mark: {
      width: 56,
      height: 56,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: t.ink,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    markBolt: {color: t.ink, fontFamily: FONT.semibold, fontSize: 26},
    wordmark: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 34,
      textAlign: 'center',
    },
    form: {
      alignSelf: 'stretch',
      gap: 10,
      paddingHorizontal: 8,
    },
    input: {
      color: t.ink,
      fontFamily: FONT.regular,
      fontSize: 16,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: 12,
      backgroundColor: t.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    footer: {
      gap: 12,
      paddingBottom: 8,
    },
    note: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 13,
      textAlign: 'center',
    },
    failed: {
      color: t.danger,
      fontFamily: FONT.regular,
      fontSize: 13,
      textAlign: 'center',
    },
  });

export function SignInScreen({onServices}: {onServices?: () => void} = {}) {
  const app = useApp();
  const t = useTheme();
  const s = local(t);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const passwordInput = useRef<TextInput>(null);
  const request = useRef<AbortController | null>(null);
  const serviceReady =
    app.serviceStatus !== 'loading' && app.serviceStatus !== 'blocked';
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setName('');
    setPassword('');
    setFailed(null);
    setBusy(false);
  }, [app.serviceUrl]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  const stop = () => {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setPassword('');
    setFailed(null);
    setStopped(true);
  };

  const attempt = async () => {
    if (busy || !serviceReady || name.trim() === '' || password === '') {
      return;
    }
    Keyboard.dismiss();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setStopped(false);
    setFailed(null);
    try {
      // The operator's name and password stay in memory for this sign-in.
      // The service stores its scrypt password hash.
      await app.signIn(name.trim(), password, {signal: controller.signal});
    } catch (e) {
      if (request.current !== controller || e instanceof ApiCancelledError) {
        return;
      }
      setFailed(
        e instanceof ApiUnreachableError
          ? SIGNIN.failed(SIGNIN.unreachable)
          : e instanceof Error
          ? SIGNIN.failed(e.message)
          : SIGNIN.failed('unknown'),
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.grow}
      enabled={Platform.OS === 'ios'}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen onStop={busy ? stop : undefined}>
        <ScrollView
          style={s.grow}
          contentContainerStyle={s.center}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={s.mark}>
            <Text style={s.markBolt}>⚡</Text>
          </View>
          <Text style={s.wordmark}>{APP_NAME}</Text>
          <InfoButton title="Operator sign-in" testID="sign-in-help">
            {`${SIGNIN.note}\n\nInstall compatible Cashu cards with your assigned account. Holders set up ownership and funding in their wallet.\n\n${SIGNIN_BUILD}`}
          </InfoButton>
          <View style={s.form}>
            {onServices ? (
              <SecondaryButton
                title={
                  app.serviceStatus === 'loading'
                    ? 'LOADING SERVICE…'
                    : `SERVICE: ${
                        opsDashboardUrl(app.serviceUrl) ?? app.serviceUrl
                      }`
                }
                testID="sign-in-service"
                disabled={busy || app.serviceStatus === 'loading'}
                onPress={onServices}
              />
            ) : null}
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={SIGNIN.namePlaceholder}
              placeholderTextColor={t.dim}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy && serviceReady}
              style={s.input}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordInput.current?.focus()}
              autoComplete="username"
              textContentType="username"
              accessibilityLabel="Operator name"
              testID="sign-in-name"
            />
            <TextInput
              ref={passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder={SIGNIN.passwordPlaceholder}
              placeholderTextColor={t.dim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!busy && serviceReady}
              style={s.input}
              returnKeyType="go"
              onSubmitEditing={attempt}
              autoComplete="current-password"
              textContentType="password"
              accessibilityLabel="Password"
              testID="sign-in-password"
            />
          </View>
          <LegalLinks />
        </ScrollView>
        <View style={s.footer}>
          <PrimaryButton
            title={busy ? SIGNIN.signingIn : SIGNIN.button}
            onPress={() => attempt()}
            disabled={
              busy || !serviceReady || name.trim() === '' || password === ''
            }
            testID="sign-in"
          />
          {app.serviceError ? (
            <Text style={s.failed} accessibilityLiveRegion="polite">
              {app.serviceError}
            </Text>
          ) : null}
          {app.serviceStatus === 'blocked' ? (
            <SecondaryButton
              title="RELOAD SERVICE SETTINGS"
              testID="sign-in-service-reload"
              onPress={app.reloadServices}
            />
          ) : null}
          {failed ? (
            <Text style={s.failed} testID="sign-in-failed">
              {failed}
            </Text>
          ) : stopped || busy ? (
            <Text style={s.note} accessibilityLiveRegion="polite">
              {stopped
                ? 'Sign-in stopped.'
                : 'Checking your account… Keep this screen open.'}
            </Text>
          ) : null}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** The load set this build makes, the same pin the batch screen states. */
const SIGNIN_BUILD = `Builds the 2.1 card · Load file ${CASHU_LOAD_FILE.sha256.slice(
  0,
  8,
)}…`;
