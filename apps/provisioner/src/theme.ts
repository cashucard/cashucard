/**
 * The design tokens of docs/PROVISIONER-APP.md: Foxy's palette under a
 * neutral name layer, both themes, the phone's own choice. One place for
 * every color, so a brand skin later is a set of values here, never a fork
 * of the screens.
 */
import {useColorScheme} from 'react-native';

export interface Theme {
  dark: boolean;
  /** Screen background. */
  bg: string;
  /** Raised surface: rows, the batch card, inputs. */
  card: string;
  /** Primary text. */
  ink: string;
  /** Secondary text (60% ink in the source material). */
  dim: string;
  /** The one strong color; the success state and the progress fill. */
  accent: string;
  /** Danger stripe and its ink. */
  danger: string;
  /** Hairlines between rows. */
  line: string;
}

export const DARK: Theme = {
  dark: true,
  bg: '#050505',
  card: '#1C1C1E',
  ink: '#FFFFFF',
  dim: 'rgba(255,255,255,0.6)',
  accent: '#3AB54A',
  danger: '#E5484D',
  line: 'rgba(255,255,255,0.12)',
};

export const LIGHT: Theme = {
  dark: false,
  bg: '#FAFAF8',
  card: '#F7F7F5',
  ink: '#0B0B0B',
  dim: 'rgba(11,11,11,0.6)',
  accent: '#3AB54A',
  danger: '#D13438',
  line: 'rgba(11,11,11,0.12)',
};

/**
 * The theme the app shows: the store's choice (system/dark/light) provided by
 * ThemeProvider in store.tsx, falling back to the phone's own scheme when no
 * provider is above (the bench screen in tests).
 */
import {createContext, useContext} from 'react';

const ThemeCtx = createContext<Theme | null>(null);
export const ThemeProvider = ThemeCtx.Provider;

export function useTheme(): Theme {
  const provided = useContext(ThemeCtx);
  const system = useColorScheme();
  if (provided) {
    return provided;
  }
  return system === 'light' ? LIGHT : DARK;
}

/** The system scheme, resolved against the store's choice. */
export function resolveTheme(
  choice: 'system' | 'dark' | 'light',
  system: 'light' | 'dark' | null | undefined,
): Theme {
  if (choice === 'dark') {
    return DARK;
  }
  if (choice === 'light') {
    return LIGHT;
  }
  return system === 'light' ? LIGHT : DARK;
}

/** Figtree is the brand face; tabular figures wherever a number moves. */
export const FONT = {
  regular: 'Figtree-Regular',
  medium: 'Figtree-Medium',
  semibold: 'Figtree-SemiBold',
  /** Growing counters and ids: monospaced digits. */
  tabular: 'Figtree-SemiBold',
} as const;
