import { describe, expect, it } from "vitest";

import { planAcquisitionMethods } from "../src/acquisition-method-planner.js";

describe("planAcquisitionMethods", () => {
  it("routes YouTube through official/public metadata before generic capture", () => {
    const plan = planAcquisitionMethods({ url: "https://www.youtube.com/watch?v=vjSZIyYd0NI" });

    expect(plan.platform).toBe("youtube");
    expect(plan.methods[0]).toMatchObject({
      key: "youtube_official_api_or_served_metadata",
      tier: "official_api",
      trust: "farm_direct"
    });
    expect(plan.refusalBoundaries.join("\n")).toContain("raw media stream");
  });

  it("offers a caged external bridge only when a public capture failure and opt-in are both present", () => {
    const disabled = planAcquisitionMethods({
      url: "https://blog.naver.com/example",
      observedFailure: "browser_blocked",
      allowExternalBridge: false
    });
    expect(disabled.methods.some((method) => method.key === "caged_external_bridge_byo")).toBe(false);

    const enabled = planAcquisitionMethods({
      url: "https://blog.naver.com/example",
      observedFailure: "browser_blocked",
      allowExternalBridge: true
    });
    const bridge = enabled.methods.find((method) => method.key === "caged_external_bridge_byo");
    expect(bridge).toMatchObject({
      tier: "external_bridge",
      trust: "external_untrusted",
      captureMethod: "byo-bridge"
    });
    expect(enabled.decision).toContain("caged BYO/external-bridge");
  });

  it("does not suggest an external bridge for login, paywall, or captcha boundaries", () => {
    const plan = planAcquisitionMethods({
      url: "https://example.com/private",
      observedFailure: "login_or_paywall",
      allowExternalBridge: true
    });

    expect(plan.methods.some((method) => method.key === "caged_external_bridge_byo")).toBe(false);
    expect(plan.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "consented_profile_or_human_byo_only",
          status: "terminal",
          trust: "operator_consent"
        })
      ])
    );
    expect(plan.decision).toContain("Do not escalate autonomously");
  });

  it("keeps BYO capture as the universal verifier fallback", () => {
    const plan = planAcquisitionMethods({ url: "https://example.com/page" });
    expect(plan.methods.at(-1)).toMatchObject({
      key: "universal_byo_capture_registration",
      tier: "byo_capture"
    });
    expect(plan.knowledgeBaseTags).toEqual(expect.arrayContaining(["leesearch", "insane-search-dna", "claim-gate"]));
  });
});
