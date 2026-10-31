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
import NfcManager from "react-native-nfc-manager";
import * as sdk from "@cashu-card/cardkit";
import { sha256 } from "@noble/hashes/sha2";
import { secp256k1, schnorr } from "@noble/curves/secp256k1";
import { withCard, cancelCard } from "./src/session";
import {
  PINS,
  OPTIMIZED_PINS,
  runCapacityOptimized,
  STREAMED_PINS,
  runCapacityStreamed,
  runCreation,
  runCapacity,
  resumeJournal,
  stoppedSession,
  CAPACITY_DIAGNOSTIC_PLAN,
  runCapacityDiagnostics,
} from "./pixel-control";
import { CAPACITY_PLAN } from "./pixel-capacity";
import asset from "./pixel-asset.json";

const streamed = asset.mode === "capacity-streamed";
const optimized = asset.mode === "capacity-optimized";
const CARD_PINS = streamed ? STREAMED_PINS : optimized ? OPTIMIZED_PINS : PINS;
const diagnostics = asset.mode === "capacity-diagnostics";
const capacity =
  streamed || optimized || diagnostics || asset.mode === "capacity";
const PLAN = streamed
  ? STREAMED_PINS.plan
  : optimized
    ? OPTIMIZED_PINS.plan
    : diagnostics
      ? CAPACITY_DIAGNOSTIC_PLAN
      : capacity
        ? CAPACITY_PLAN
        : PINS.plan;
// An explicitly reviewed diagnostic invocation gets its own one-shot journal.
// Earlier capacity records remain untouched in the same app's storage.
const JOURNAL = streamed
  ? "cashucard-private-capacity-streamed-v1"
  : optimized
    ? "cashucard-private-capacity-optimized-v1"
    : diagnostics
      ? "cashucard-private-capacity-diagnostics-v1"
      : capacity
        ? "cashucard-private-capacity-v1"
        : "cashucard-private-creation-v1";
export default function App() {
  const [record, setRecord] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const running = useRef(false),
    aborted = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(JOURNAL)
      .then((value) => {
        setRecord(resumeJournal(value, PLAN));
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
      plan: PLAN,
      status: "armed",
      stage: "waiting-for-card",
      artifact: {
        source: CARD_PINS.source,
        cap: CARD_PINS.cap,
        load: CARD_PINS.load,
      },
      build: asset.build,
      armedAt: new Date().toISOString(),
    };
    try {
      // Consumed before NFC is armed. Relaunch cannot silently create a second attempt.
      await save(current);
      const result = await withCard(
        "Hold card 09336320 still until the test ends.",
        async (tx) => {
          const limits = {
            platform: "android",
            androidTimeoutMs: await NfcManager.getTimeout(),
            maxTransceive: await NfcManager.getMaxTransceiveLength(),
          };
          const run = streamed
            ? runCapacityStreamed
            : optimized
              ? runCapacityOptimized
              : diagnostics
                ? runCapacityDiagnostics
                : capacity
                  ? runCapacity
                  : runCreation;
          return run({
            sdk,
            tx,
            limits,
            load: sdk.fromHex(asset.loadHex),
            fixture: capacity ? sdk.fromHex(asset.fixtureHex) : undefined,
            verifySignature: (signature, message, key) =>
              schnorr.verify(
                Uint8Array.from(signature),
                Uint8Array.from(message),
                Uint8Array.from(key),
              ),
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
          });
        },
      );
      current = {
        ...current,
        ...result.value,
        session: result.meta,
        stamps: result.stamps,
        sessionTeardownRequested: true,
      };
      await save(current);
    } catch {
      current = stoppedSession(current);
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
        <Text style={styles.title}>
          {streamed
            ? "Pixel streamed capacity"
            : optimized
              ? "Pixel optimized capacity"
              : diagnostics
                ? "Pixel capacity diagnostics"
                : capacity
                  ? "Pixel capacity test"
                  : "Pixel creation test"}
        </Text>
        <Text style={styles.copy}>
          Card 09336320 only. Hold it still until the result appears.
        </Text>
        <Text style={styles.copy}>
          {capacity
            ? "Loads 128 synthetic proof slots, signs the fixed payment, verifies all 91 export pages and both signatures, then retires the fixture and returns the card to blank."
            : "Creates the private opener and applet, reads diagnostics and its public key, then removes the private package. No setup, payment fixtures or manager-key changes."}
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
          {record?.failedExchange
            ? "\n" +
              record.failedExchange.category +
              " · " +
              (record.failedExchange.elapsedMs ?? "unknown") +
              " ms call envelope"
            : ""}
        </Text>
        {record === null && (
          <Pressable
            style={styles.button}
            onPress={begin}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>
              {capacity ? "START CAPACITY TEST" : "START CREATION TEST"}
            </Text>
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
          CAP {CARD_PINS.cap}
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
