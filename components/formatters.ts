export const formatLanguage = (lang: string, isoCodeMap: Record<string, string>): string => {
  const isoCode = isoCodeMap[lang] || '';
  const displayName = lang.charAt(0).toUpperCase() + lang.slice(1);
  return `${displayName} (${isoCode})`;
}; 