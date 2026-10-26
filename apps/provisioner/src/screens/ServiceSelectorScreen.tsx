import React, {useState} from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useApp} from '../store';
import {normalizeServiceOrigin} from '../serviceProfiles';
import {opsDashboardUrl} from '../LegalLinks';
import {FONT, useTheme} from '../theme';
import {Dim, InfoButton, PrimaryButton, Screen, SecondaryButton} from '../ui';

export function ServiceSelectorScreen({onDone}: {onDone(): void}) {
  const app = useApp(),
    t = useTheme();
  const [input, setInput] = useState(''),
    [candidate, setCandidate] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const busy = saving || app.serviceStatus === 'loading';
  const review = (value: string, saved = false) => {
    Keyboard.dismiss();
    try {
      setCandidate(saved ? value : normalizeServiceOrigin(value));
      setNotice(null);
    } catch {
      setNotice(
        'Enter an HTTPS service address, such as https://ops.example.com.',
      );
    }
  };
  const s = StyleSheet.create({
    content: {gap: 18, paddingBottom: 24},
    card: {backgroundColor: t.card, borderRadius: 16, padding: 18, gap: 12},
    title: {fontFamily: FONT.semibold, fontSize: 20, color: t.ink},
    text: {fontFamily: FONT.regular, fontSize: 16, color: t.ink},
    row: {paddingVertical: 12, minHeight: 52, gap: 4},
    input: {
      fontFamily: FONT.regular,
      fontSize: 16,
      color: t.ink,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: 12,
      padding: 14,
    },
  });
  return (
    <Screen
      title="Ops service"
      onBack={onDone}
      headerRight={
        <InfoButton title="Choosing a service" testID="services-help">
          {
            'Use the ops-service provided by your card issuer. Each service has its own operator accounts and card records. Signing in sends your operator credentials to the selected address. Saved batches and resets stay on this phone, bound to that exact API address and account. Different addresses for the same server can have separate saved work.'
          }
        </InfoButton>
      }>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {candidate ? (
          <View style={s.card}>
            <Text style={s.title}>Use this service?</Text>
            <Text selectable style={s.text} testID="service-review-origin">
              {candidate}
            </Text>
            <Dim>
              Enter this service’s operator credentials after switching. Saved
              work stays with its original service.
            </Dim>
            <PrimaryButton
              title={saving ? 'SAVING…' : 'USE THIS SERVICE'}
              testID="service-confirm"
              disabled={busy}
              onPress={async () => {
                setSaving(true);
                setNotice(null);
                try {
                  await app.selectService(candidate);
                  onDone();
                } catch (e) {
                  setNotice(
                    e instanceof Error
                      ? e.message
                      : 'Service selection could not be saved.',
                  );
                } finally {
                  setSaving(false);
                }
              }}
            />
            <SecondaryButton
              title="KEEP CURRENT SERVICE"
              testID="service-keep"
              disabled={busy}
              onPress={() => setCandidate(null)}
            />
          </View>
        ) : (
          <>
            {(app.serviceProfiles ?? [app.serviceUrl]).map(origin => (
              <Pressable
                key={origin}
                testID={`service-choice-${origin}`}
                style={s.row}
                accessibilityRole="button"
                accessibilityLabel={`Choose ${
                  opsDashboardUrl(origin) ?? origin
                }`}
                accessibilityState={{
                  selected: origin === app.serviceUrl,
                  disabled: busy,
                }}
                disabled={busy}
                onPress={() =>
                  origin === app.serviceUrl && app.serviceStatus === 'ready'
                    ? onDone()
                    : review(origin, true)
                }>
                <Text style={s.text}>{opsDashboardUrl(origin) ?? origin}</Text>
                {opsDashboardUrl(origin) !== origin ? (
                  <Dim>{`API: ${origin}`}</Dim>
                ) : null}
                {origin === app.serviceUrl ? <Dim>Current service</Dim> : null}
              </Pressable>
            ))}
            <Text style={s.title}>Add a service</Text>
            <TextInput
              testID="service-origin"
              accessibilityLabel="HTTPS ops-service address"
              value={input}
              onChangeText={setInput}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              placeholder="https://ops.example.com"
              placeholderTextColor={t.dim}
              style={s.input}
              editable={!busy}
            />
            <PrimaryButton
              title="REVIEW SERVICE"
              testID="service-review"
              disabled={busy || !input.trim()}
              onPress={() => review(input)}
            />
          </>
        )}
        {notice || app.serviceError ? (
          <Text style={s.text} accessibilityLiveRegion="polite">
            {notice ?? app.serviceError}
          </Text>
        ) : null}
        {app.serviceStatus === 'blocked' ? (
          <SecondaryButton
            title="RELOAD SERVICE SETTINGS"
            disabled={busy}
            onPress={app.reloadServices}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
