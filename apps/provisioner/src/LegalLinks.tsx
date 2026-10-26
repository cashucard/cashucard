import React from 'react';
import {Alert, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {FONT, useTheme} from './theme';

export const OPS_DASHBOARD_URL = 'https://ops.cashucard.org';

export function OpsDashboardLink({
  testID,
  textTestID,
}: {
  testID: string;
  textTestID?: string;
}) {
  const t = useTheme();
  const s = StyleSheet.create({
    link: {minHeight: 44, justifyContent: 'center', flexShrink: 1},
    label: {
      color: t.dim,
      fontFamily: FONT.regular,
      fontSize: 14,
      textDecorationLine: 'underline',
    },
  });
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel="Open ops dashboard"
      style={s.link}
      onPress={async () => {
        try {
          await Linking.openURL(OPS_DASHBOARD_URL);
        } catch {
          Alert.alert(
            'Unable to open dashboard',
            `Open ${OPS_DASHBOARD_URL} in your browser.`,
          );
        }
      }}>
      <Text testID={textTestID} style={s.label}>
        {OPS_DASHBOARD_URL}
      </Text>
    </Pressable>
  );
}

const links = [
  {
    id: 'privacy',
    label: 'Privacy Policy',
    url: 'https://getflash.io/legal/privacy.html',
  },
  {id: 'terms', label: 'Terms', url: 'https://getflash.io/legal/terms.html'},
  {id: 'support', label: 'Support', url: 'mailto:support@getflash.io'},
] as const;

export function LegalLinks() {
  const theme = useTheme();
  return (
    <View style={styles.links}>
      {links.map(link => (
        <Pressable
          key={link.id}
          accessibilityRole="link"
          testID={`legal-${link.id}`}
          style={styles.link}
          onPress={async () => {
            try {
              await Linking.openURL(link.url);
            } catch {
              Alert.alert(
                'Unable to open link',
                link.id === 'support'
                  ? 'Email support@getflash.io from your preferred email app.'
                  : 'Please try again later.',
              );
            }
          }}>
          <Text style={[styles.label, {color: theme.dim}]}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  links: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'},
  link: {paddingHorizontal: 12, minHeight: 44, justifyContent: 'center'},
  label: {
    fontFamily: FONT.regular,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
