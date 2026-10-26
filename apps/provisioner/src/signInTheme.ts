/** Sign-in uses the Cashu Card palette from brand/tokens.json. */
import {DARK, LIGHT, type Theme} from './theme';

export const SIGN_IN_DARK: Theme = {
  ...DARK,
  bg: '#10271E',
  card: '#15332A',
  ink: '#EDF3E7',
  dim: '#BECFC0',
  accent: '#D3F39A',
  line: '#355044',
  danger: '#F39489',
};
export const SIGN_IN_LIGHT: Theme = {
  ...LIGHT,
  bg: '#F3F7EE',
  card: '#FAFCF7',
  ink: '#10271E',
  dim: '#557A62',
  accent: '#235D3C',
  line: '#D5DFD0',
  danger: '#A23935',
};
