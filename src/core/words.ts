// Word strings, coarse alphabet, class keys and the prefix-match rule.
import { NAMES, COARSE, ID, isLunar } from './symbols';
import { classEnd } from './cr3bp';

export function fineName(id: number) { return NAMES[id]; }

/** map ids to names in the chosen alphabet, removing consecutive duplicates */
export function wordNames(tokens: number[], coarse: boolean): string[] {
  const out: string[] = [];
  for (const id of tokens) {
    const n = coarse ? COARSE[id] : NAMES[id];
    if (out[out.length - 1] !== n) out.push(n);
  }
  return out;
}

/** star the terminal impact token as in the paper (M_C*, E_C*) */
export function decorate(names: string[], status: number): string[] {
  const a = names.slice();
  if ((status === 1 || status === 2) && a.length) a[a.length - 1] += '*';
  return a;
}

/** paper class word: truncated after the first exit from the lunar region */
export function classWord(tokens: number[], status: number, coarse: boolean): string {
  const k = classEnd(tokens);
  const t = k >= 0 ? tokens.slice(0, k + 1) : tokens;
  const impact = k < 0 && (status === 1 || status === 2);
  const names = wordNames(t, coarse);
  if (impact) names[names.length - 1] += '*';
  else if (k < 0 && names.length && isLunar(t[t.length - 1])) names.push('M_*'); // still lunar at horizon
  return names.join(' ');
}

/** number of leading user tokens realised by the trajectory (prefix match) */
export function matchLength(tokens: number[], user: number[], coarse: boolean): number {
  const a = wordNames(tokens, coarse), b = wordNames(user, coarse);
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

export function isFullMatch(tokens: number[], user: number[], coarse: boolean) {
  return matchLength(tokens, user, coarse) === wordNames(user, coarse).length;
}

export const lunarEntryIndex = (user: number[]) =>
  user.length >= 2 && !isLunar(user[0]) && isLunar(user[1]) && user[1] !== ID.MC ? 0 : -1;
