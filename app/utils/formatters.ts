import { languageToISOCode } from "../constants/languages";

export const formatLanguage = (lang: string): string => {
  const isoCode = languageToISOCode[lang] || '';
  const displayName = lang.charAt(0).toUpperCase() + lang.slice(1);
  return `${displayName} (${isoCode})`;
}; 