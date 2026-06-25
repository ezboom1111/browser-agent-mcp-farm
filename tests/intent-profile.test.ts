import { describe, expect, it } from "vitest";

import { planIntentProfile } from "../src/intent-profile.js";

describe("planIntentProfile", () => {
  it("keeps intent locking soft: clear price/UI intent becomes locked with concrete modalities", () => {
    const profile = planIntentProfile({
      url: "https://example.com/product",
      sourcePlatform: "generic",
      sourceFamily: "commerce",
      intent: {
        decisionNeeded: "Compare competitor price and checkout UI",
        targetScope: "Korean public product pages this week",
        evidenceShapes: ["structured_data", "page_text", "ui_screenshot", "ocr_image_text"],
        successCriteria: "Find price deltas and UI trust signals",
        boundaries: "No login or payment action"
      }
    });

    expect(profile.status).toBe("locked");
    expect(profile.autonomyMode).toBe("soft_lock");
    expect(profile.recommendedOptions).toMatchObject({
      captureProfile: "full",
      ocr: true
    });
    expect(profile.evidencePlan).toEqual(expect.arrayContaining([expect.objectContaining({ shape: "structured_data", farmSupport: "native" }), expect.objectContaining({ shape: "ui_screenshot", farmSupport: "native" }), expect.objectContaining({ shape: "ocr_image_text", farmSupport: "native_opt_in" })]));
  });

  it("does not block autonomy when intent is missing; it records assumptions and questions", () => {
    const profile = planIntentProfile({
      url: "https://blog.naver.com/example/1",
      sourcePlatform: "naver_blog",
      sourceFamily: "blog"
    });

    expect(profile.status).toBe("underspecified");
    expect(profile.provisionalAssumptions.length).toBeGreaterThan(0);
    expect(profile.questions.length).toBeGreaterThan(0);
    expect(profile.efficiencyGuard).toContain("Ask only when the missing field changes capture modality");
  });

  it("routes STT/TTS/audio needs outside farm while keeping BYO verification", () => {
    const profile = planIntentProfile({
      url: "https://example.com/video",
      sourcePlatform: "generic",
      sourceFamily: "video_social",
      intent: {
        decisionNeeded: "Detect whether creator voice sounds synthetic",
        targetScope: "public video",
        evidenceShapes: ["video_frames", "captions_transcript", "stt_asr", "tts_detection", "audio_events"],
        successCriteria: "Separate visual claim from audio/TTS claim",
        boundaries: "No raw stream download"
      }
    });

    expect(profile.status).toBe("locked");
    expect(profile.recommendedOptions).toMatchObject({
      sampleFrames: true,
      denseSampling: true
    });
    expect(profile.evidencePlan).toEqual(
      expect.arrayContaining([expect.objectContaining({ shape: "stt_asr", farmSupport: "external_heavy" }), expect.objectContaining({ shape: "tts_detection", farmSupport: "external_heavy_or_unsupported" }), expect.objectContaining({ shape: "audio_events", farmSupport: "external_heavy_or_unsupported" })])
    );
    expect(profile.boundaryWarnings.join("\n")).toContain("raw audio/video");
  });
});
