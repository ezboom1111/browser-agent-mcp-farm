export const OCR_TEXT_SCRIPT_VALUES = [
  "latin",
  "hangul",
  "hiragana",
  "katakana",
  "cjk",
  "digit",
  "currency"
] as const;

export type OcrTextScript = typeof OCR_TEXT_SCRIPT_VALUES[number];

export interface OcrTextProfile {
  lineCount: number;
  nonWhitespaceCharCount: number;
  scripts: OcrTextScript[];
  hasDigits: boolean;
  hasCurrency: boolean;
  hasPriceLikeText: boolean;
  priceLikeTokenCount: number;
  hasPercentLikeText: boolean;
  hasMapLikeText: boolean;
  hasTravelOrCommerceLikeText: boolean;
  hasRatingLikeText: boolean;
  hasDistanceLikeText: boolean;
  hasBusinessHoursLikeText: boolean;
  hasContactLikeText: boolean;
  hasReservationLikeText: boolean;
  hasMenuLikeText: boolean;
  hasCommercePolicyLikeText: boolean;
}

const CURRENCY_MARKER_SOURCE = String.raw`[$\u00a3\u00a5\u20a9\u20ac\uffe5]|\b(?:USD|EUR|GBP|JPY|KRW)\b|[\uc6d0\u5186]`;
const DIGIT_AMOUNT_SOURCE = String.raw`[0-9\uff10-\uff19][0-9\uff10-\uff19,.\u0020\u00a0]*`;

const SCRIPT_PATTERNS: Array<[OcrTextScript, RegExp]> = [
  ["latin", /[A-Za-z]/],
  ["hangul", /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/],
  ["hiragana", /[\u3040-\u309f]/],
  ["katakana", /[\u30a0-\u30ff]/],
  ["cjk", /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/],
  ["digit", /[0-9\uff10-\uff19]/],
  ["currency", new RegExp(CURRENCY_MARKER_SOURCE, "i")]
];

const PRICE_LIKE_PATTERNS = [
  new RegExp(`(?:${CURRENCY_MARKER_SOURCE})\\s*${DIGIT_AMOUNT_SOURCE}`, "i"),
  new RegExp(`${DIGIT_AMOUNT_SOURCE}\\s*(?:${CURRENCY_MARKER_SOURCE})`, "i")
];

const PRICE_LIKE_TOKEN_PATTERN = new RegExp(
  `(?:${CURRENCY_MARKER_SOURCE})\\s*${DIGIT_AMOUNT_SOURCE}|${DIGIT_AMOUNT_SOURCE}\\s*(?:${CURRENCY_MARKER_SOURCE})`,
  "gi"
);

const PERCENT_LIKE_PATTERN = /[0-9\uff10-\uff19][0-9\uff10-\uff19,.\u0020\u00a0]*\s*(?:%|\bpercent\b|\boff\b|\bdiscount\b|\bsale\b|\ud560\uc778|\u5272\u5f15|\u5024\u5f15)/i;

const MAP_LIKE_PATTERN = /\b(?:map|maps|route|station|street|nearby|directions|walk|walkable|subway|metro|km|meters?|mins?|minutes?|open|hours?|reviews?)\b|(?:\uc9c0\ub3c4|\uc5ed|\uac70\ub9ac|\ub3c4\ubcf4|\ubd84|\ucd9c\uad6c|\uc9c0\ud558\ucca0|\uc8fc\uc18c|\uc601\uc5c5\uc911|\uc601\uc5c5\uc2dc\uac04|\ub9ac\ubdf0|\uc804\ud654|\uc8fc\ucc28|\u99c5|\u5730\u56f3|\u5f92\u6b69|\u5206|\u51fa\u53e3|\u4f4f\u6240|\u55b6\u696d\u4e2d|\u55b6\u696d\u6642\u9593|\u30ec\u30d3\u30e5\u30fc|\u96fb\u8a71|\u99d0\u8eca)/i;

const TRAVEL_OR_COMMERCE_PATTERN = /\b(?:hotel|room|night|guest|tax|fee|fees|cancellation|free cancellation|breakfast|check-?in|checkout|booking|agoda|trip\.com|expedia|coupon|shipping|seller|return|deal|offer|price)\b|(?:\ud638\ud154|\uac1d\uc2e4|\uc219\ubc15|\uc219\uc18c|\uc138\uae08|\uc218\uc218\ub8cc|\uc694\uae08|\ucd5c\uc800\uac00|\ubb34\ub8cc\ucde8\uc18c|\ubc30\uc1a1|\ubc18\ud488|\ud310\ub9e4\uc790|\ucfe0\ud3f0|\uc608\uc57d|\u30db\u30c6\u30eb|\u5bbf\u6cca|\u90e8\u5c4b|\u6599\u91d1|\u6700\u5b89|\u7a0e\u8fbc|\u7a0e|\u624b\u6570\u6599|\u4e88\u7d04|\u8fd4\u54c1|\u914d\u9001|\u30ad\u30e3\u30f3\u30bb\u30eb\u7121\u6599)/i;

const RATING_LIKE_PATTERN = /\b(?:rating|rated|review score|stars?|reviews?)\s*[0-5](?:[.,][0-9])?\b|\b[0-5](?:[.,][0-9])?\s*(?:stars?|\/5)\b|(?:\ud3c9\uc810|\ubcc4\uc810|\ub9ac\ubdf0)\s*[0-5](?:[.,][0-9])?|[0-5](?:[.,][0-9])?\s*(?:\uc810|\ub9ac\ubdf0)|(?:\u8a55\u4fa1|\u30ec\u30d3\u30e5\u30fc)\s*[0-5](?:[.,][0-9])?|[0-5](?:[.,][0-9])?\s*(?:\u70b9|\u30ec\u30d3\u30e5\u30fc)/i;

const DISTANCE_LIKE_PATTERN = /\b[0-9\uff10-\uff19][0-9\uff10-\uff19,.\u0020\u00a0]*\s*(?:m|km|meters?|kilometers?|mins?|minutes?)\b|\b(?:walk|walking|drive|driving)\s*[0-9\uff10-\uff19][0-9\uff10-\uff19,.\u0020\u00a0]*(?:\s*(?:m|km|mins?|minutes?))?\b|(?:\ub3c4\ubcf4\s*[0-9\uff10-\uff19]+(?:\s*\ubd84)?|[0-9\uff10-\uff19]+\s*\ubd84|[0-9\uff10-\uff19]+(?:m|km)|\u5f92\u6b69\s*[0-9\uff10-\uff19]+(?:\s*\u5206)?|[0-9\uff10-\uff19]+\s*\u5206|[0-9\uff10-\uff19]+\s*(?:m|km|\u30e1\u30fc\u30c8\u30eb))/i;

const BUSINESS_HOURS_LIKE_PATTERN = /\b(?:open(?:\s*now)?|closed|business hours|hours?)\b|\b[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?\s*(?:-|~|\u2013)\s*[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?\b|(?:\uc601\uc5c5\uc911|\uc601\uc5c5\uc2dc\uac04|\ud734\ubb34|\ub9c8\uac10|\uc624\ud508|\u55b6\u696d\u4e2d|\u55b6\u696d\u6642\u9593|\u5b9a\u4f11\u65e5|\u4f11\u696d|\u958b\u5e97|\u9589\u5e97|[0-9]{1,2}[:\uff1a][0-9]{2}\s*(?:-|~|\u2013)\s*[0-9]{1,2}[:\uff1a][0-9]{2})/i;

const CONTACT_LIKE_PATTERN = /\b(?:phone|tel|call|address|contact)\b|\b[0-9]{2,4}[-.\s][0-9]{3,4}[-.\s][0-9]{4}\b|(?:\uc804\ud654|\uc5f0\ub77d\ucc98|\uc8fc\uc18c|\ub3c4\ub85c\uba85|\ubc88\uae38|\u96fb\u8a71|\u9023\u7d61\u5148|\u4f4f\u6240|\u4e01\u76ee|\u756a\u5730|\u901a\u308a|\u3012[0-9])/i;

const RESERVATION_LIKE_PATTERN = /\b(?:reserve|reservation|book\s*now|book\s*a\s*(?:table|room|stay|slot)|make\s*a\s*booking)\b|(?:\uc608\uc57d|\uc608\ub9e4|\ub124\uc774\ubc84\s*\uc608\uc57d|\uc608\uc57d\ud558\uae30|\uc608\uc57d\uac00\ub2a5|\u4e88\u7d04|\u4e88\u7d04\u3059\u308b|\u4e88\u7d04\u53ef|\u7a7a\u5ba4\u4e88\u7d04)/i;

const MENU_LIKE_PATTERN = /\b(?:menu|menus|food\s*menu|drink\s*menu|rate\s*menu|room\s*menu)\b|(?:\uba54\ub274|\uba54\ub274\ud310|\uc2dd\ub2e8|\uc74c\uc2dd\uba54\ub274|\uc8fc\ub958\uba54\ub274|\u30e1\u30cb\u30e5\u30fc|\u304a\u54c1\u66f8\u304d|\u6599\u7406\u30e1\u30cb\u30e5\u30fc|\u30c9\u30ea\u30f3\u30af\u30e1\u30cb\u30e5\u30fc)/i;

const COMMERCE_POLICY_LIKE_PATTERN = /\b(?:free\s*cancellation|cancellation|refund|return|exchange|shipping|delivery|tax|taxes|fee|fees|seller|warranty|terms?)\b|(?:\ubb34\ub8cc\s*\ucde8\uc18c|\ubb34\ub8cc\ucde8\uc18c|\ucde8\uc18c|\ud658\ubd88|\ubc18\ud488|\uad50\ud658|\ubc30\uc1a1|\ud0dd\ubc30|\uc138\uae08|\uc218\uc218\ub8cc|\ud310\ub9e4\uc790|\ubcf4\uc99d|\uc57d\uad00|\u30ad\u30e3\u30f3\u30bb\u30eb\u7121\u6599|\u30ad\u30e3\u30f3\u30bb\u30eb|\u8fd4\u91d1|\u8fd4\u54c1|\u4ea4\u63db|\u914d\u9001|\u9001\u6599|\u7a0e\u8fbc|\u7a0e|\u624b\u6570\u6599|\u8ca9\u58f2\u8005|\u4fdd\u8a3c|\u898f\u7d04)/i;

export function buildOcrTextProfile(text: string): OcrTextProfile {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const scripts = SCRIPT_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([script]) => script);
  const hasDigits = scripts.includes("digit");
  const hasCurrency = scripts.includes("currency");
  const hasPriceLikeText = PRICE_LIKE_PATTERNS.some((pattern) => pattern.test(text));
  const priceLikeTokenCount = countMatches(text, PRICE_LIKE_TOKEN_PATTERN);

  return {
    lineCount: lines.length,
    nonWhitespaceCharCount: text.replace(/\s+/g, "").length,
    scripts,
    hasDigits,
    hasCurrency,
    hasPriceLikeText,
    priceLikeTokenCount,
    hasPercentLikeText: PERCENT_LIKE_PATTERN.test(text),
    hasMapLikeText: MAP_LIKE_PATTERN.test(text),
    hasTravelOrCommerceLikeText: TRAVEL_OR_COMMERCE_PATTERN.test(text),
    hasRatingLikeText: RATING_LIKE_PATTERN.test(text),
    hasDistanceLikeText: DISTANCE_LIKE_PATTERN.test(text),
    hasBusinessHoursLikeText: BUSINESS_HOURS_LIKE_PATTERN.test(text),
    hasContactLikeText: CONTACT_LIKE_PATTERN.test(text),
    hasReservationLikeText: RESERVATION_LIKE_PATTERN.test(text),
    hasMenuLikeText: MENU_LIKE_PATTERN.test(text),
    hasCommercePolicyLikeText: COMMERCE_POLICY_LIKE_PATTERN.test(text)
  };
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text) !== null) {
    count += 1;
  }
  pattern.lastIndex = 0;
  return count;
}
