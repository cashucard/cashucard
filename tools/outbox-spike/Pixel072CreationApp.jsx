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
import { secp256k1 } from "@noble/curves/secp256k1";
import { withCard, cancelCard } from "./src/session";
import { PINS, runCreation, resumeJournal } from "./pixel-07297620-create";
import { createLabJournal } from "./lab-journal";
import asset from "./card072-asset.json";
export default function App() {
  const [record, setRecord] = useState(undefined),
    [busy, setBusy] = useState(false),
    running = useRef(false),
    aborted = useRef(false);
  const saveRef = useRef(null);
  if (saveRef.current === null)
    saveRef.current = createLabJournal({
      write: (raw) => AsyncStorage.setItem(PINS.journalKey, raw),
      present: setRecord,
    });
  const save = saveRef.current;
  useEffect(() => {
    AsyncStorage.getItem(PINS.journalKey)
      .then((raw) => setRecord(resumeJournal(raw)))
      .catch(() =>
        setRecord({ status: "stopped", failure: "journal-unavailable" }),
      );
    return () => {
      aborted.current = true;
      cancelCard();
    };
  }, []);
  const begin = async () => {
    if (running.current || record !== null) return;
    running.current = true;
    aborted.current = false;
    setBusy(true);
    let current = {
      plan: PINS.plan,
      chip: PINS.chip,
      status: "armed",
      stage: "waiting-for-card",
      artifact: { source: PINS.source, cap: PINS.cap, load: PINS.load },
      build: asset.build,
      armedAt: new Date().toISOString(),
    };
    try {
      await save(current);
      if (asset.build.appId !== PINS.appId || asset.build.plan !== PINS.plan)
        throw Error("asset mismatch");
      const result = await withCard(
        "Hold card 07297620 still until the test ends.",
        async (tx) =>
          runCreation({
            sdk,
            tx,
            load: sdk.fromHex(asset.loadHex),
            hash: (a) => sdk.toHex(sha256(Uint8Array.from(a))).toLowerCase(),
            random: (n) => global.crypto.getRandomValues(new Uint8Array(n)),
            now: () => performance.now(),
            cancelled: () => aborted.current,
            limits: {
              platform: "android",
              androidTimeoutMs: await NfcManager.getTimeout(),
              maxTransceive: await NfcManager.getMaxTransceiveLength(),
            },
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
        sessionTeardownRequested: true,
      };
      await save(current);
    } catch {
      current = {
        ...current,
        status: "stopped",
        failure: current.failure || "nfc-or-journal-stopped",
        sessionTeardownRequested: true,
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
  const complete = record?.status === "installed-unset-up";
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>PRIVATE CREATION CONTROL</Text>
        <Text style={styles.title}>Card 07297620</Text>
        <Text style={styles.copy}>
          Creates the pinned opener and applet, verifies the registry, and reads
          unset-up diagnostics and the new public key. The installation stays on
          the card.
        </Text>
        <Text style={styles.status}>
          {complete
            ? "Created · ready for the next planned test"
            : record?.status === "stopped"
              ? "Stopped · keep the card aside"
              : busy
                ? "Keep holding the card"
                : record
                  ? "Saved attempt · no automatic retry"
                  : "Ready for the approved test"}
        </Text>
        <Text selectable style={styles.detail}>
          {record?.stage || "One attempt"}
          {record?.commands ? "\n" + record.commands + " commands" : ""}
          {record?.failure ? "\n" + record.failure : ""}
          {record?.cardKey ? "\nPublic key " + record.cardKey : ""}
        </Text>
        {record === null && (
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={begin}
          >
            <Text style={styles.buttonText}>START CREATION TEST</Text>
          </Pressable>
        )}
        {busy && (
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => {
              aborted.current = true;
              cancelCard();
            }}
          >
            <Text style={styles.copy}>STOP</Text>
          </Pressable>
        )}
        {record && !busy && (
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() =>
              Share.share({ message: JSON.stringify(record, null, 2) })
            }
          >
            <Text style={styles.copy}>SHARE PUBLIC RESULT</Text>
          </Pressable>
        )}
        <Text style={styles.fine}>
          No setup, funding, signing, key rotation or cleanup. A stopped test
          keeps its journal and sends no retry. This app has no network
          permission.
        </Text>
        <Text selectable style={styles.fine}>
          CAP {PINS.cap}
          {"\n"}Source {asset.build.source}
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
  status: { color: "#d6f3a3", fontSize: 23, fontWeight: "600" },
  detail: { color: "#edf4de", fontSize: 15, lineHeight: 23 },
  button: { backgroundColor: "#b8df69", borderRadius: 16, padding: 20 },
  buttonText: { color: "#10271e", textAlign: "center", fontWeight: "700" },
  secondary: {
    borderColor: "#91ab8e",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  fine: { color: "#91ab8e", fontSize: 12, lineHeight: 18 },
});
