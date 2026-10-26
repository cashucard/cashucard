import AsyncStorage from '@react-native-async-storage/async-storage';
export interface BatchDefaults {
  mint: string;
  count: number;
}
interface Actor {
  service_origin: string;
  operator_id: number;
  key_env: 'factory' | 'issued';
}
const key = (actor: Actor) =>
  `cashu.provisioner.batch-defaults.v1:${JSON.stringify([
    actor.service_origin,
    actor.operator_id,
    actor.key_env,
  ])}`;
export async function readBatchDefaults(
  actor: Actor,
): Promise<BatchDefaults | null> {
  try {
    const raw = await AsyncStorage.getItem(key(actor));
    if (!raw || raw.length > 4096) {
      return null;
    }
    const value = JSON.parse(raw);
    return typeof value.mint === 'string' &&
      value.mint.length > 0 &&
      value.mint.length <= 2048 &&
      Number.isInteger(value.count) &&
      value.count >= 1 &&
      value.count <= 500
      ? {mint: value.mint, count: value.count}
      : null;
  } catch {
    return null;
  }
}
export async function rememberBatchDefaults(
  actor: Actor,
  value: BatchDefaults,
): Promise<void> {
  // These public form defaults are optional. Card recovery never reads this key.
  try {
    await AsyncStorage.setItem(
      key(actor),
      JSON.stringify({mint: value.mint, count: value.count}),
    );
  } catch {
    /* The confirmed batch remains in the separate durable journal. */
  }
}
