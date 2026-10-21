import React from 'react';
import {Alert, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {FONT, useTheme} from './theme';

const links = [
  {
    id: 'privacy',
    label: 'Privacy Policy',
    url: 'https://getflash.io/legal/privacy.html',
  },
  {id: 'terms', label: 'Terms', url: 'https://getflash.io/legal/terms.html'},
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
              Alert.alert('Unable to open link', 'Please try again later.');
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
