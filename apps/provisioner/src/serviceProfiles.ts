/** Public connection preferences, separate from durable card journals. */
export interface ServiceProfileStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}
export const SERVICE_PROFILES_KEY = 'cashu.provisioner.services.v1';
const nativeStorage = () => {
  const module = require('@react-native-async-storage/async-storage');
  return module.default ?? module;
};
export const serviceProfileStorage: ServiceProfileStorage = {
  read: () => nativeStorage().getItem(SERVICE_PROFILES_KEY),
  write: value => nativeStorage().setItem(SERVICE_PROFILES_KEY, value),
};

/** Avoid React Native's incomplete URL parser. Accept a DNS origin, not a URL path. */
export function normalizeServiceOrigin(input: string): string {
  const match = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?\/?$/i.exec(
    input.trim(),
  );
  const invalid = () => {
    throw new Error(
      'Enter an HTTPS service address without a path, login, query or fragment.',
    );
  };
  if (!match) {
    return invalid();
  }
  const host = match[1].toLowerCase(),
    labels = host.split('.');
  if (
    host.length > 253 ||
    labels.length < 2 ||
    labels.every(label => /^[0-9]+$/.test(label)) ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    return invalid();
  }
  const port = match[2] ? Number(match[2]) : 443;
  if (port < 1 || port > 65535) {
    return invalid();
  }
  return `https://${host}${port === 443 ? '' : `:${port}`}`;
}

export interface ServiceProfiles {
  selected: string;
  origins: string[];
}
export function decodeServiceProfiles(
  raw: string | null,
  defaultOrigin: string,
): ServiceProfiles {
  if (raw === null) {
    return {selected: defaultOrigin, origins: [defaultOrigin]};
  }
  if (raw.length > 16384) {
    throw new Error('Service preferences could not be read.');
  }
  const value = JSON.parse(raw);
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'origins,schema,selected' ||
    value.schema !== 1 ||
    !Array.isArray(value.origins) ||
    value.origins.length > 32 ||
    typeof value.selected !== 'string' ||
    !value.origins.includes(value.selected) ||
    new Set(value.origins).size !== value.origins.length ||
    value.origins.some(
      (origin: unknown) =>
        typeof origin !== 'string' ||
        (origin !== defaultOrigin && normalizeServiceOrigin(origin) !== origin),
    )
  ) {
    throw new Error('Service preferences could not be read.');
  }
  return {
    selected: value.selected,
    origins: [
      ...new Set([defaultOrigin, value.selected, ...value.origins]),
    ].slice(0, 32) as string[],
  };
}
export const encodeServiceProfiles = (value: ServiceProfiles) =>
  JSON.stringify({schema: 1, ...value});
