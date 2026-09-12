/**
 * Primary subtag of a BCP-47-ish tag, lowercased. Tolerates the underscore and
 * three-letter forms that appear in HLS `LANGUAGE` attributes.
 */
export const primarySubtag = (tag: string): string =>
  tag.trim().toLowerCase().replaceAll('_', '-').split('-')[0] ?? '';

/** ISO-639-2/639-3 aliases for languages whose HLS tags vary between codes. */
const ALIASES: Record<string, string> = {
  jpn: 'ja',
  jp: 'ja',
  eng: 'en',
  kor: 'ko',
  zho: 'zh',
  chi: 'zh',
  fra: 'fr',
  fre: 'fr',
  deu: 'de',
  ger: 'de',
  spa: 'es',
  por: 'pt',
  ita: 'it',
  rus: 'ru',
  ara: 'ar',
};

/** Canonical primary language for comparison purposes. */
export const canonicalPrimary = (tag: string): string => {
  const primary = primarySubtag(tag);
  return ALIASES[primary] ?? primary;
};

/** True when two language tags refer to the same primary language. */
export const sameLanguage = (a: string, b: string): boolean => {
  const left = canonicalPrimary(a);
  return Boolean(left) && left === canonicalPrimary(b);
};

export const isJapanese = (tag: string | undefined): boolean =>
  typeof tag === 'string' && canonicalPrimary(tag) === 'ja';
