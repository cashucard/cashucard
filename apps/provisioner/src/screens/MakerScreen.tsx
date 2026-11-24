/**
 * The card maker setting (D239): the maker's name and the address every card's
 * NFC tag opens, set once per ops service by the person making cards. The
 * installation gate (releaseGates.ts) installs nothing until it is saved on
 * this phone. A fork's own maker file only pre-fills this form.
 */
import React, {useState} from 'react';
import {Keyboard, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {useProvisioning} from '../ProvisioningStore';
import {makerProblem} from '../maker';
import {MAKER_SETTING} from '../strings';
import {FONT, useTheme, type Theme} from '../theme';
import {Dim, PrimaryButton, Screen, SecondaryButton} from '../ui';

const local = (t: Theme) =>
  StyleSheet.create({
    content: {gap: 18, paddingBottom: 24},
    card: {backgroundColor: t.card, borderRadius: 16, padding: 18, gap: 12},
    label: {fontFamily: FONT.semibold, fontSize: 16, color: t.ink},
    text: {fontFamily: FONT.regular, fontSize: 16, color: t.ink},
    dim: {fontFamily: FONT.regular, fontSize: 13, color: t.dim},
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

/** The maker and the tag address, as every screen that leads to an install shows them. */
export function MakerSummary({
  maker,
  note,
}: {
  maker: {name: string; tagAddress: string};
  note?: string;
}) {
  const s = local(useTheme());
  return (
    <View style={s.card} testID="maker-summary">
      <Text style={s.dim}>{MAKER_SETTING.title}</Text>
      <Text style={s.label} testID="maker-summary-name">
        {maker.name}
      </Text>
      <Text style={s.dim}>{MAKER_SETTING.address}</Text>
      <Text selectable style={s.text} testID="maker-summary-address">
        {maker.tagAddress}
      </Text>
      {note ? <Dim>{note}</Dim> : null}
    </View>
  );
}

export function MakerScreen({onBack}: {onBack(): void}) {
  const flow = useProvisioning();
  const t = useTheme();
  const s = local(t);
  // The saved maker, not the gate's answer: it shows when the gate is closed too.
  const current = flow.savedMaker;
  // With none saved, a fork's own maker file fills the form in. Nothing is saved by that.
  const prefill = current ?? flow.makerPrefill;
  const [name, setName] = useState(prefill?.name ?? '');
  const [address, setAddress] = useState(prefill?.tagAddress ?? '');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const value = {name: name.trim(), tagAddress: address.trim()};
  const changed =
    !current ||
    current.name !== value.name ||
    current.tagAddress !== value.tagAddress;
  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const problem = await flow.saveMaker(value.name, value.tagAddress);
      setConfirming(false);
      setNotice(problem ?? MAKER_SETTING.saved);
    } finally {
      setSaving(false);
    }
  };
  const review = () => {
    Keyboard.dismiss();
    const problem = makerProblem(value.name, value.tagAddress);
    if (problem) {
      setNotice(problem);
    } else if (flow.makerSaved && changed) {
      // A saved maker changes only by a second, deliberate step.
      setNotice(null);
      setConfirming(true);
    } else {
      save();
    }
  };
  return (
    <Screen title={MAKER_SETTING.title} onBack={saving ? undefined : onBack}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {confirming ? (
          <View style={s.card}>
            <Text style={s.label}>{MAKER_SETTING.changeTitle}</Text>
            <Text style={s.text} testID="maker-review-name">
              {value.name}
            </Text>
            <Text selectable style={s.text} testID="maker-review-address">
              {value.tagAddress}
            </Text>
            <Dim>{MAKER_SETTING.changeNote}</Dim>
            <PrimaryButton
              title={saving ? MAKER_SETTING.saving : MAKER_SETTING.change}
              testID="maker-confirm"
              disabled={saving || flow.busy}
              onPress={save}
            />
            <SecondaryButton
              title={MAKER_SETTING.keep}
              testID="maker-keep"
              disabled={saving}
              onPress={() => setConfirming(false)}
            />
          </View>
        ) : (
          <>
            <Text style={s.text}>{MAKER_SETTING.what}</Text>
            <Text style={s.label}>{MAKER_SETTING.name}</Text>
            <TextInput
              testID="maker-name"
              accessibilityLabel={MAKER_SETTING.name}
              value={name}
              onChangeText={setName}
              autoCorrect={false}
              autoComplete="off"
              maxLength={64}
              placeholder={MAKER_SETTING.namePlaceholder}
              placeholderTextColor={t.dim}
              style={s.input}
              editable={!saving}
            />
            <Text style={s.label}>{MAKER_SETTING.address}</Text>
            <Text style={s.text}>{MAKER_SETTING.tagWhat}</Text>
            <TextInput
              testID="maker-address"
              accessibilityLabel={MAKER_SETTING.address}
              value={address}
              onChangeText={setAddress}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              placeholder={MAKER_SETTING.addressPlaceholder}
              placeholderTextColor={t.dim}
              style={s.input}
              editable={!saving}
            />
            <Dim>{MAKER_SETTING.published}</Dim>
            <Dim>{MAKER_SETTING.scope}</Dim>
            {!current && flow.makerPrefill ? (
              <Dim>{MAKER_SETTING.fromFile}</Dim>
            ) : null}
            <PrimaryButton
              title={saving ? MAKER_SETTING.saving : MAKER_SETTING.save}
              testID="maker-save"
              disabled={
                saving || flow.busy || (flow.makerSaved && !changed)
              }
              onPress={review}
            />
          </>
        )}
        {notice ? (
          <Text
            style={s.text}
            accessibilityLiveRegion="polite"
            testID="maker-notice">
            {notice}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
