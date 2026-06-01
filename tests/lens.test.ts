import { describe, expect, it } from "vitest";
import { describeLens, getLens, lensSummaries, listLenses, selectLensSources } from "../src/lens.js";
import { ClaimTypeSchema, EvidenceKindSchema } from "../src/schemas.js";

// Engine #3: declarative research lenses. A lens is config over the same engine + gate — domain
// selection + claim templates + report shape — so marketing/planning/etc. are data, not forked code.

describe("lens registry", () => {
  it("lists the built-in lenses and resolves by id", () => {
    const ids = listLenses().map((lens) => lens.id);
    expect(ids).toContain("research");
    expect(ids).toContain("market_scan");
    expect(ids).toContain("product_planning");
    expect(getLens("market_scan")?.displayName).toMatch(/marketing/i);
    expect(getLens("does-not-exist")).toBeUndefined();
  });

  it("every lens claim template uses a VALID claim type and grounding evidence kinds (config guard)", () => {
    for (const lens of listLenses()) {
      expect(lens.claimTemplates.length).toBeGreaterThan(0);
      expect(lens.reportSections.length).toBeGreaterThan(0);
      for (const template of lens.claimTemplates) {
        expect(ClaimTypeSchema.safeParse(template.claimType).success).toBe(true);
        expect(template.groundingEvidenceKinds.length).toBeGreaterThan(0);
        for (const kind of template.groundingEvidenceKinds) {
          expect(EvidenceKindSchema.safeParse(kind).success).toBe(true);
        }
      }
    }
  });

  it("lensSummaries exposes only id/displayName/description (compact for discovery)", () => {
    for (const summary of lensSummaries()) {
      expect(Object.keys(summary).sort()).toEqual(["description", "displayName", "id"]);
    }
  });
});

describe("lens source selection", () => {
  it("selects real source-registry entries for a lens, deduped by platform", () => {
    const lens = getLens("market_scan");
    expect(lens).toBeDefined();
    const sources = selectLensSources(lens as NonNullable<typeof lens>);
    expect(sources.length).toBeGreaterThan(0);
    const platforms = sources.map((entry) => entry.platform);
    expect(new Set(platforms).size).toBe(platforms.length); // no duplicate platforms
  });

  it("describeLens returns the lens plus its prioritized sources; undefined for an unknown id", () => {
    const described = describeLens("product_planning");
    expect(described?.lens.id).toBe("product_planning");
    expect(Array.isArray(described?.sources)).toBe(true);
    for (const source of described?.sources ?? []) {
      expect(typeof source.platform).toBe("string");
      expect(typeof source.displayName).toBe("string");
    }
    expect(describeLens("nope")).toBeUndefined();
  });
});
