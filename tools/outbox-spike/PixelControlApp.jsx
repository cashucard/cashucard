import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  Text,
  Pressable,
  Share,
  StyleSheet,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as sdk from "@cashu-card/cardkit";
import { sha256 } from "@noble/hashes/sha2";
import { secp256k1 } from "@noble/curves/secp256k1";
import { withCard, cancelCard } from "./src/session";
import { PINS, runCreation } from "./pixel-control";
import asset from "./pixel-asset.json";

const JOURNAL = "cashucard-private-creation-v1";
export default function App() {
  const [record, setRecord] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const running = useRef(false),
    aborted = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(JOURNAL)
      .then((value) => {
        try {
          setRecord(value === null ? null : JSON.parse(value));
        } catch {
          setRecord({ status: "stopped", failure: "saved-journal-unreadable" });
        }
      })
      .catch(() =>
        setRecord({ status: "stopped", failure: "journal-unavailable" }),
      );
    return () => {
      aborted.current = true;
      cancelCard();
    };
  }, []);
  const save = async (value) => {
    await AsyncStorage.setItem(JOURNAL, JSON.stringify(value));
    setRecord(value);
  };
  const begin = async () => {
    if (running.current || record !== null) return;
    running.current = true;
    aborted.current = false;
    setBusy(true);
    let current = {
      plan: PINS.plan,
      status: "armed",
      stage: "waiting-for-card",
      artifact: { source: PINS.source, cap: PINS.cap, load: PINS.load },
      build: asset.build,
      armedAt: new Date().toISOString(),
    };
    try {
      // Consumed before NFC is armed. Relaunch cannot silently create a second attempt.
      await save(current);
      const result = await withCard(
        "Hold card 09336320 still until the test ends.",
        async (tx) =>
          runCreation({
            sdk,
            tx,
            load: sdk.fromHex(asset.loadHex),
            hash: (bytes) =>
              sdk.toHex(sha256(Uint8Array.from(bytes))).toLowerCase(),
            random: (n) => global.crypto.getRandomValues(new Uint8Array(n)),
            now: () => performance.now(),
            cancelled: () => aborted.current,
            validateKey: (key) => {
              try {
                secp256k1.ProjectivePoint.fromHex(
                  Uint8Array.from(key),
                ).assertValidity();
                return true;
              } catch {
                return false;
              }
            },
            save: async (next) => {
              current = { ...current, ...next };
              await save(current);
            },
          }),
      );
      current = {
        ...current,
        ...result.value,
        session: result.meta,
        stamps: result.stamps,
        sessionClosed: true,
      };
      await save(current);
    } catch {
      current = {
        ...current,
        status: "stopped",
        failure: "nfc-or-journal-stopped",
        sessionClosed: true,
      };
      try {
        await save(current);
      } catch {
        setRecord({ ...current, journalUnavailable: true });
      }
    } finally {
      setBusy(false);
    }
  };
  const complete =
    record?.status === "complete" && record?.blankBaselineVerified;
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>PRIVATE HARDWARE CONTROL</Text>
        <Text style={styles.title}>Pixel creation test</Text>
        <Text style={styles.copy}>
          Card 09336320 only. Hold it still until the result appears.
        </Text>
        <Text style={styles.copy}>
          Creates the private opener and applet, reads diagnostics and its
          public key, then removes the private package. No setup, payment
          fixtures or manager-key changes.
        </Text>
        <Text style={styles.status}>
          {complete
            ? "Complete · card verified blank"
            : record?.status === "stopped"
              ? "Stopped · keep the card aside"
              : busy
                ? "Keep holding the card"
                : record
                  ? "Saved attempt · no automatic retry"
                  : "Ready for the approved test"}
        </Text>
        <Text selectable style={styles.detail}>
          {record?.stage || "One attempt per installation"}
          {record?.commands ? "\n" + record.commands + " commands" : ""}
          {record?.failure ? "\n" + record.failure : ""}
        </Text>
        {record === null && (
          <Pressable
            style={styles.button}
            onPress={begin}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>START CREATION TEST</Text>
          </Pressable>
        )}
        {busy && (
          <Pressable
            style={styles.secondary}
            onPress={() => {
              aborted.current = true;
              cancelCard();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.text}>STOP</Text>
          </Pressable>
        )}
        {record && !busy && (
          <Pressable
            style={styles.secondary}
            onPress={() =>
              Share.share({ message: JSON.stringify(record, null, 2) })
            }
            accessibilityRole="button"
          >
            <Text style={styles.text}>SHARE PUBLIC TEST RESULT</Text>
          </Pressable>
        )}
        <Text style={styles.fine}>
          A stopped test preserves its journal and sends no cleanup or retry.
          Leave the card aside for a reviewed cleanup plan. This app has no
          network permission and does not sign into an ops-service.
        </Text>
        <Text selectable style={styles.fine}>
          CAP {PINS.cap}
          {"\n"}
          {asset.build.source}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#10271e" },
  content: { padding: 24, gap: 22 },
  eyebrow: { color: "#b8df69", fontSize: 12, letterSpacing: 2 },
  title: { color: "#edf4de", fontSize: 34, fontWeight: "700" },
  copy: { color: "#bdcdbd", fontSize: 16, lineHeight: 23 },
  status: { color: "#d6f3a3", fontSize: 24, fontWeight: "600" },
  detail: { color: "#edf4de", fontSize: 15, lineHeight: 23 },
  button: { backgroundColor: "#b8df69", borderRadius: 16, padding: 20 },
  buttonText: { color: "#10271e", textAlign: "center", fontWeight: "700" },
  secondary: {
    borderColor: "#91ab8e",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  text: { color: "#edf4de", textAlign: "center" },
  fine: { color: "#91ab8e", fontSize: 12, lineHeight: 18 },
});
