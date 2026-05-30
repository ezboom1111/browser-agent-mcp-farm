import { describe, expect, it } from "vitest";
import { buildOcrTextProfile } from "../src/ocr-text-profile.js";

describe("buildOcrTextProfile", () => {
  it("detects scripts needed for map and travel OCR fixtures", () => {
    const profile = buildOcrTextProfile("Naver Map\n\ub124\uc774\ubc84 \uc9c0\ub3c4\n\u6771\u4eac\u99c5\nAgoda \u20a9120,000\nTrip.com JPY 12,300");

    expect(profile.lineCount).toBe(5);
    expect(profile.nonWhitespaceCharCount).toBeGreaterThan(0);
    expect(profile.scripts).toEqual(expect.arrayContaining([
      "latin",
      "hangul",
      "cjk",
      "digit",
      "currency"
    ]));
    expect(profile.hasDigits).toBe(true);
    expect(profile.hasCurrency).toBe(true);
    expect(profile.hasPriceLikeText).toBe(true);
    expect(profile.priceLikeTokenCount).toBe(2);
    expect(profile.hasMapLikeText).toBe(true);
    expect(profile.hasTravelOrCommerceLikeText).toBe(true);
    expect(profile.hasPercentLikeText).toBe(false);
  });

  it("does not classify numeric non-price overlay text as price-like", () => {
    const profile = buildOcrTextProfile("Route 2\nGate 14\nFloor 3");

    expect(profile.scripts).toEqual(expect.arrayContaining(["latin", "digit"]));
    expect(profile.hasDigits).toBe(true);
    expect(profile.hasCurrency).toBe(false);
    expect(profile.hasPriceLikeText).toBe(false);
    expect(profile.priceLikeTokenCount).toBe(0);
    expect(profile.hasRatingLikeText).toBe(false);
    expect(profile.hasDistanceLikeText).toBe(false);
    expect(profile.hasBusinessHoursLikeText).toBe(false);
    expect(profile.hasContactLikeText).toBe(false);
    expect(profile.hasReservationLikeText).toBe(false);
    expect(profile.hasMenuLikeText).toBe(false);
    expect(profile.hasCommercePolicyLikeText).toBe(false);
  });

  it("requires currency and amount to appear as a price-like token", () => {
    const separated = buildOcrTextProfile("Currency: KRW\nRoute 2\nGate 14");
    const koreanPrice = buildOcrTextProfile("\uc11c\uc6b8\uc5ed\n1,200\uc6d0");
    const japanesePrice = buildOcrTextProfile("\u6771\u4eac\u99c5\n\uffe512,300");

    expect(separated.hasDigits).toBe(true);
    expect(separated.hasCurrency).toBe(true);
    expect(separated.hasPriceLikeText).toBe(false);
    expect(separated.priceLikeTokenCount).toBe(0);
    expect(koreanPrice.hasPriceLikeText).toBe(true);
    expect(koreanPrice.priceLikeTokenCount).toBe(1);
    expect(japanesePrice.hasPriceLikeText).toBe(true);
    expect(japanesePrice.priceLikeTokenCount).toBe(1);
    expect(koreanPrice.scripts).toEqual(expect.arrayContaining(["hangul", "digit", "currency"]));
    expect(japanesePrice.scripts).toEqual(expect.arrayContaining(["cjk", "digit", "currency"]));
  });

  it("detects travel commerce and percent badge OCR context without treating it as a price", () => {
    const profile = buildOcrTextProfile("Booking.com hotel deal\n\ucfe0\ud3f0 15% \ud560\uc778\nFree cancellation\nNo price loaded");

    expect(profile.hasTravelOrCommerceLikeText).toBe(true);
    expect(profile.hasPercentLikeText).toBe(true);
    expect(profile.hasDigits).toBe(true);
    expect(profile.hasCurrency).toBe(false);
    expect(profile.hasPriceLikeText).toBe(false);
    expect(profile.priceLikeTokenCount).toBe(0);
  });

  it("detects Korean place-card map context without turning ratings into prices", () => {
    const profile = buildOcrTextProfile("\ub124\uc774\ubc84 \uc9c0\ub3c4\n\uc131\uc218\uc5ed 2\ubc88 \ucd9c\uad6c \ub3c4\ubcf4 5\ubd84\n\uc601\uc5c5\uc911 \ub9ac\ubdf0 4.5 \uc804\ud654");

    expect(profile.scripts).toEqual(expect.arrayContaining(["hangul", "digit"]));
    expect(profile.hasMapLikeText).toBe(true);
    expect(profile.hasTravelOrCommerceLikeText).toBe(false);
    expect(profile.hasPriceLikeText).toBe(false);
    expect(profile.priceLikeTokenCount).toBe(0);
    expect(profile.hasRatingLikeText).toBe(true);
    expect(profile.hasDistanceLikeText).toBe(true);
    expect(profile.hasBusinessHoursLikeText).toBe(true);
    expect(profile.hasContactLikeText).toBe(true);
    expect(profile.hasReservationLikeText).toBe(false);
    expect(profile.hasMenuLikeText).toBe(false);
    expect(profile.hasCommercePolicyLikeText).toBe(false);
  });

  it("detects Japanese local place-card context without producing price evidence", () => {
    const profile = buildOcrTextProfile("\u5730\u56f3\n\u65b0\u5bbf\u99c5 \u6771\u53e3 \u5f92\u6b69 3\u5206\n\u55b6\u696d\u6642\u9593 10:00-22:00\n\u8a55\u4fa1 4.2 \u4f4f\u6240 \u96fb\u8a71");

    expect(profile.scripts).toEqual(expect.arrayContaining(["cjk", "digit"]));
    expect(profile.hasMapLikeText).toBe(true);
    expect(profile.hasTravelOrCommerceLikeText).toBe(false);
    expect(profile.hasPriceLikeText).toBe(false);
    expect(profile.priceLikeTokenCount).toBe(0);
    expect(profile.hasRatingLikeText).toBe(true);
    expect(profile.hasDistanceLikeText).toBe(true);
    expect(profile.hasBusinessHoursLikeText).toBe(true);
    expect(profile.hasContactLikeText).toBe(true);
    expect(profile.hasReservationLikeText).toBe(false);
    expect(profile.hasMenuLikeText).toBe(false);
    expect(profile.hasCommercePolicyLikeText).toBe(false);
  });

  it("detects Japanese travel price cards with tax and cancellation context", () => {
    const profile = buildOcrTextProfile("\u697d\u5929\u30c8\u30e9\u30d9\u30eb \u30db\u30c6\u30eb\n1\u6cca \uffe512,300 \u7a0e\u8fbc\n\u30ad\u30e3\u30f3\u30bb\u30eb\u7121\u6599");

    expect(profile.scripts).toEqual(expect.arrayContaining(["katakana", "cjk", "digit", "currency"]));
    expect(profile.hasTravelOrCommerceLikeText).toBe(true);
    expect(profile.hasCurrency).toBe(true);
    expect(profile.hasPriceLikeText).toBe(true);
    expect(profile.priceLikeTokenCount).toBe(1);
    expect(profile.hasTravelOrCommerceLikeText).toBe(true);
    expect(profile.hasRatingLikeText).toBe(false);
    expect(profile.hasCommercePolicyLikeText).toBe(true);
  });

  it("detects reservation menu and policy OCR context without producing price evidence", () => {
    const koreanPlace = buildOcrTextProfile("\ub124\uc774\ubc84 \uc9c0\ub3c4\n\uc131\uc218 \uce74\ud398\n\uba54\ub274 \uc608\uc57d\ud558\uae30 \uc601\uc5c5\uc911\n\uc8fc\uc18c \uc804\ud654");
    const japaneseHotel = buildOcrTextProfile("\u6771\u4eac \u30db\u30c6\u30eb\n\u4e88\u7d04\u53ef \u30e1\u30cb\u30e5\u30fc\n\u30ad\u30e3\u30f3\u30bb\u30eb\u7121\u6599 \u9001\u6599 0\u5186");
    const englishPolicy = buildOcrTextProfile("Reserve a table\nMenu\nFree cancellation refund terms");

    expect(koreanPlace.hasMapLikeText).toBe(true);
    expect(koreanPlace.hasReservationLikeText).toBe(true);
    expect(koreanPlace.hasMenuLikeText).toBe(true);
    expect(koreanPlace.hasCommercePolicyLikeText).toBe(false);
    expect(koreanPlace.hasPriceLikeText).toBe(false);

    expect(japaneseHotel.hasTravelOrCommerceLikeText).toBe(true);
    expect(japaneseHotel.hasReservationLikeText).toBe(true);
    expect(japaneseHotel.hasMenuLikeText).toBe(true);
    expect(japaneseHotel.hasCommercePolicyLikeText).toBe(true);
    expect(japaneseHotel.hasPriceLikeText).toBe(true);

    expect(englishPolicy.hasReservationLikeText).toBe(true);
    expect(englishPolicy.hasMenuLikeText).toBe(true);
    expect(englishPolicy.hasCommercePolicyLikeText).toBe(true);
    expect(englishPolicy.hasPriceLikeText).toBe(false);
  });
});
