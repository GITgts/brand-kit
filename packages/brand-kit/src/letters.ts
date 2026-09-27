/** Monogram letters from a company name. Shared so UI and service agree. */

const LEGAL_SUFFIXES =
  /\b(bv|bvba|nv|sa|srl|sprl|cv|cvba|vzw|asbl|vof|comm\.?\s?v|gmbh|ag|ltd|limited|llc|inc|corp|co|plc|group|groep|holding|international|belgium|belgi[eë]|benelux)\b\.?/gi;

const STOPWORDS = /^(de|het|the|le|la|les|van|der|den|and|en|&|et)$/i;

/**
 * "Brantano" → "BR", "Gavan Group" → "GA", "TIN Construct" → "TC",
 * "De Kleine Bakkerij" → "KB", "3M" → "3M". Override from the UI when needed.
 */
export function deriveMonogramLetters(name: string): string {
  const cleaned = name
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .trim();
  const words = cleaned.split(/[\s-]+/).filter((w) => w && !STOPWORDS.test(w));
  if (words.length === 0) return (name.trim()[0] ?? '?').toUpperCase();
  if (words.length === 1) {
    const w = words[0];
    // Keep existing short acronyms / internal capitals: "HubSpot" → "HS", "ABB" → "AB".
    const caps = w.match(/\p{Lu}/gu);
    if (caps && caps.length >= 2 && w.length > 3 && w !== w.toUpperCase()) return (caps[0] + caps[1]).toUpperCase();
    return w.slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}
