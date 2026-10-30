/** Cashu Card's forest palette, shared by every operator screen. */
import {createContext, useContext} from 'react';

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  ink: string;
  dim: string;
  accent: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  line: string;
}

/** Values follow brand/tokens.json and the approved sign-in design. */
export const DARK: Theme = {
  dark: true,
  bg: '#10271E',
  card: '#15332A',
  ink: '#EDF3E7',
  dim: '#BECFC0',
  accent: '#D3F39A',
  onAccent: '#10271E',
  danger: '#F39489',
  onDanger: '#10271E',
  line: '#355044',
};

const ThemeCtx = createContext<Theme | null>(null);
export const ThemeProvider = ThemeCtx.Provider;

/** Standalone tools use the same palette as the signed-in app. */
export function useTheme(): Theme {
  return useContext(ThemeCtx) ?? DARK;
}

/** Figtree is the brand face; tabular figures wherever a number moves. */
export const FONT = {
  regular: 'Figtree-Regular',
  medium: 'Figtree-Medium',
  semibold: 'Figtree-SemiBold',
  /** Growing counters and ids: monospaced digits. */
  tabular: 'Figtree-SemiBold',
} as const;
