/** Operator sign-in. Keep the action above the keyboard and the form scrollable. */
import React, {useEffect, useRef, useState} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {ApiCancelledError, ApiUnreachableError} from '../api';
import {CASHU_LOAD_FILE} from '../assets/cashu';
import {SIGNIN} from '../strings';
import {useApp} from '../store';
import {LegalLinks, opsDashboardUrl} from '../LegalLinks';
import {FONT, useTheme, type Theme} from '../theme';
import LogoDark from '../assets/brand/cashu-card-lockup-on-dark.svg';
import {InfoButton, Screen, SecondaryButton} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    grow: {flex: 1},
    center: {
      flexGrow: 1,
      justifyContent: 'center',
      width: '100%',
      maxWidth: 440,
      alignSelf: 'center',
      gap: 30,
      paddingHorizontal: 16,
      paddingTop: 36,
      paddingBottom: 20,
    },
    brand: {width: '100%', maxWidth: 252, aspectRatio: 573.8 / 125},
    intro: {gap: 10},
    eyebrow: {
      color: t.dim,
      fontFamily: FONT.medium,
      fontSize: 12,
      letterSpacing: 2,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heading: {
      color: t.ink,
      fontFamily: FONT.semibold,
      fontSize: 36,
      lineHeight: 44,
      letterSpacing: -1.3,
      flexShrink: 1,
    },
    form: {gap: 20},
    field: {gap: 8},
    label: {color: t.ink, fontFamily: FONT.medium, fontSize: 13},
    serviceChoice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 68,
      paddingHorizontal: 15,
      paddingVertical: 13,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 12,
    },
    servicePressed: {borderColor: t.accent},
    disabled: {opacity: 0.45},
    serviceIdentity: {flex: 1, gap: 4},
    serviceLabel: {color: t.dim, fontFamily: FONT.regular, fontSize: 12},
    serviceHost: {color: t.ink, fontFamily: FONT.medium, fontSize: 15},
    serviceAction: {flexDirection: 'row', alignItems: 'center', gap: 6},
    serviceChange: {color: t.accent, fontFamily: FONT.medium, fontSize: 14},
    serviceChevron: {color: t.dim, fontSize: 22},
    input: {
      color: t.ink,
      fontFamily: FONT.regular,
      fontSize: 16,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 10,
      backgroundColor: t.card,
      minHeight: 54,
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    inputFocused: {
      borderColor: t.accent,
      backgroundColor: '#1B3B30',
    },
    footer: {
      width: '100%',
      maxWidth: 440,
      alignSelf: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    submit: {
      minHeight: 56,
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderRadius: 12,
      backgroundColor: t.accent,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    submitPressed: {opacity: 0.85},
    submitText: {
      color: t.onAccent,
      fontFamily: FONT.semibold,
      fontSize: 17,
    },
    submitArrow: {color: t.onAccent, fontSize: 24},
    note: {color: t.dim, fontFamily: FONT.regular, fontSize: 13},
    failed: {color: t.danger, fontFamily: FONT.regular, fontSize: 13},
  });

export function SignInScreen({onServices}: {onServices?: () => void} = {}) {
  const app = useApp();
  const t = useTheme();
  const Logo = LogoDark;
  const s = local(t);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState<'name' | 'password' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const passwordInput = useRef<TextInput>(null);
  const request = useRef<AbortController | null>(null);
  const serviceReady =
    app.serviceStatus !== 'loading' && app.serviceStatus !== 'blocked';
  const serviceAddress = opsDashboardUrl(app.serviceUrl) ?? app.serviceUrl;
  const serviceHost = serviceAddress.replace(/^https?:\/\//, '');
  const serviceLoading = app.serviceStatus === 'loading';
  const serviceChoiceDisabled = busy || serviceLoading;
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

  const disabled =
    busy || !serviceReady || name.trim() === '' || password === '';
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
          <View style={s.brand}>
            <Logo
              width="100%"
              height="100%"
              accessible
              accessibilityRole="image"
              accessibilityLabel="Cashu Card"
              testID="sign-in-brand"
            />
          </View>
          <View style={s.intro}>
            <Text style={s.eyebrow}>Card provisioner</Text>
            <View style={s.headingRow}>
              <Text style={s.heading} accessibilityRole="header">
                Sign in
              </Text>
              <InfoButton title="Operator sign-in" testID="sign-in-help">
                {`${SIGNIN.note}\n\nInstall compatible Cashu cards with your assigned account. Holders set up ownership and funding in their wallet.\n\n${SIGNIN_BUILD}`}
              </InfoButton>
            </View>
          </View>
          <View style={s.form}>
            {onServices ? (
              <Pressable
                testID="sign-in-service"
                accessibilityRole="button"
                accessibilityLabel={
                  serviceLoading
                    ? 'Loading ops service'
                    : `Change ops service. Current service: ${serviceAddress}`
                }
                accessibilityHint="Choose a saved service or add an address."
                accessibilityState={{
                  disabled: serviceChoiceDisabled,
                  busy: serviceLoading,
                }}
                disabled={serviceChoiceDisabled}
                onPress={() => {
                  Keyboard.dismiss();
                  onServices();
                }}
                style={({pressed}) => [
                  s.serviceChoice,
                  pressed && s.servicePressed,
                  serviceChoiceDisabled && s.disabled,
                ]}>
                <View style={s.serviceIdentity}>
                  <Text style={s.serviceLabel} testID="sign-in-service-label">
                    Ops service
                  </Text>
                  <Text
                    style={s.serviceHost}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    testID="sign-in-service-host">
                    {serviceLoading ? 'Loading…' : serviceHost}
                  </Text>
                </View>
                <View style={s.serviceAction}>
                  <Text style={s.serviceChange} testID="sign-in-service-change">
                    Change
                  </Text>
                  <Text style={s.serviceChevron}>›</Text>
                </View>
              </Pressable>
            ) : null}
            <View style={s.field}>
              <Text style={s.label}>Operator name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your operator name"
                placeholderTextColor={t.dim}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy && serviceReady}
                style={[s.input, focused === 'name' && s.inputFocused]}
                onFocus={() => setFocused('name')}
                onBlur={() => setFocused(null)}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordInput.current?.focus()}
                autoComplete="username"
                textContentType="username"
                accessibilityLabel="Operator name"
                testID="sign-in-name"
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>Password</Text>
              <TextInput
                ref={passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={t.dim}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!busy && serviceReady}
                style={[s.input, focused === 'password' && s.inputFocused]}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                returnKeyType="go"
                onSubmitEditing={attempt}
                autoComplete="current-password"
                textContentType="password"
                accessibilityLabel="Password"
                testID="sign-in-password"
              />
            </View>
          </View>
          <LegalLinks />
        </ScrollView>
        <View style={s.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? SIGNIN.signingIn : SIGNIN.button}
            accessibilityState={{disabled, busy}}
            disabled={disabled}
            onPress={() => attempt()}
            style={({pressed}) => [
              s.submit,
              pressed && !disabled && s.submitPressed,
              disabled && s.disabled,
            ]}
            testID="sign-in">
            <Text style={s.submitText}>
              {busy ? SIGNIN.signingIn : SIGNIN.button}
            </Text>
            <Text style={s.submitArrow}>→</Text>
          </Pressable>
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
