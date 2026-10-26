import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {FONT, useTheme} from './theme';

/** Tap-to-read help works on touch screens and with screen readers. */
export function InfoButton({
  title,
  children,
  testID,
  accessibilityLabel,
  bodyTestID,
}: {
  title: string;
  children: string;
  testID: string;
  accessibilityLabel?: string;
  bodyTestID?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null),
    heading = useRef<Text>(null);
  const focusFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (focusFrame.current !== null) {
        cancelAnimationFrame(focusFrame.current);
      }
    },
    [],
  );
  const focus = (target: View | Text | null) => {
    const handle = target && findNodeHandle(target);
    if (handle) {
      AccessibilityInfo.setAccessibilityFocus(handle);
    }
  };
  const close = () => {
    setOpen(false);
    if (focusFrame.current !== null) {
      cancelAnimationFrame(focusFrame.current);
    }
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      focus(trigger.current);
    });
  };
  const s = StyleSheet.create({
    trigger: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    icon: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: t.dim,
      color: t.dim,
      fontFamily: FONT.medium,
      fontSize: 16,
      lineHeight: 20,
      textAlign: 'center',
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
      padding: 16,
    },
    panel: {
      maxHeight: '85%',
      backgroundColor: t.card,
      borderRadius: 20,
      padding: 20,
      gap: 16,
    },
    header: {flexDirection: 'row', alignItems: 'center', gap: 12},
    title: {flex: 1, color: t.ink, fontFamily: FONT.semibold, fontSize: 22},
    close: {
      minWidth: 60,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {color: t.accent, fontFamily: FONT.semibold, fontSize: 17},
    body: {
      color: t.ink,
      fontFamily: FONT.regular,
      fontSize: 17,
      lineHeight: 25,
    },
  });
  return (
    <>
      <Pressable
        ref={trigger}
        testID={testID}
        style={s.trigger}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `About ${title}`}
        accessibilityState={{expanded: open}}
        onPress={() => {
          Keyboard.dismiss();
          if (open) {
            close();
          } else {
            setOpen(true);
          }
        }}>
        <Text style={s.icon} accessible={false} allowFontScaling={false}>
          i
        </Text>
      </Pressable>
      {open ? (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={close}
          onShow={() => focus(heading.current)}
          supportedOrientations={['portrait', 'landscape']}>
          <View style={s.overlay}>
            <Pressable
              accessible={false}
              style={StyleSheet.absoluteFill}
              onPress={close}
            />
            <SafeAreaView
              edges={['bottom']}
              style={s.panel}
              accessibilityViewIsModal
              onAccessibilityEscape={close}>
              <View style={s.header}>
                <Text ref={heading} style={s.title} accessibilityRole="header">
                  {title}
                </Text>
                <Pressable
                  testID={`${testID}-close`}
                  style={s.close}
                  accessibilityRole="button"
                  accessibilityLabel="Close explanation"
                  onPress={close}>
                  <Text style={s.closeText}>Close</Text>
                </Pressable>
              </View>
              <ScrollView>
                <Text style={s.body} testID={bodyTestID}>
                  {children}
                </Text>
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

export function HelpHeading({
  title,
  children,
  testID,
  titleStyle,
  accessibilityLabel,
  bodyTestID,
}: {
  title: string;
  children: string;
  testID: string;
  titleStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  bodyTestID?: string;
}) {
  const t = useTheme();
  const s = StyleSheet.create({
    row: {flexDirection: 'row', alignItems: 'center', gap: 8},
    label: {flex: 1, color: t.ink, fontFamily: FONT.medium, fontSize: 17},
  });
  return (
    <View style={s.row}>
      <Text style={[s.label, titleStyle]}>{title}</Text>
      <InfoButton
        title={title}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        bodyTestID={bodyTestID}>
        {children}
      </InfoButton>
    </View>
  );
}
