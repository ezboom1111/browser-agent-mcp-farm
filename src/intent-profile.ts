import type { SourceFamily, SourcePlatform } from "./source-strategy.js";

export const EvidenceShapeValues = ["page_text", "page_html", "structured_data", "semi_structured_dom", "ui_screenshot", "ocr_image_text", "video_frames", "captions_transcript", "stt_asr", "tts_detection", "audio_events", "map_place_state", "byte_faithful_byo"] as const;

export type EvidenceShape = (typeof EvidenceShapeValues)[number];
export type IntentStatus = "locked" | "provisional" | "underspecified";
export type ModalitySupport = "native" | "native_opt_in" | "external_heavy" | "external_heavy_or_unsupported" | "byo_only";

export interface ResearchIntentInput {
  decisionNeeded?: string | undefined;
  targetScope?: string | undefined;
  evidenceShapes?: EvidenceShape[] | undefined;
  successCriteria?: string | undefined;
  boundaries?: string | undefined;
}

export interface IntentEvidencePlanStep {
  shape: EvidenceShape;
  farmSupport: ModalitySupport;
  recommendedCapture: string;
  reason: string;
}

export interface IntentProfileReport {
  schemaVersion: "1.0";
  status: IntentStatus;
  autonomyMode: "soft_lock";
  source: {
    url: string;
    platform: SourcePlatform;
    family: SourceFamily;
  };
  intent: Required<ResearchIntentInput>;
  inferredShapes: EvidenceShape[];
  evidencePlan: IntentEvidencePlanStep[];
  recommendedOptions: {
    captureRouting: "auto" | "browser";
    captureProfile: "text" | "full";
    sampleFrames: boolean;
    ocr: boolean;
    denseSampling: boolean;
    officialApi: boolean;
    heavyPath: boolean;
    byoAllowed: boolean;
  };
  questions: string[];
  provisionalAssumptions: string[];
  boundaryWarnings: string[];
  efficiencyGuard: string;
  flexibilityGuard: string;
}

export interface PlanIntentProfileInput {
  url: string;
  sourcePlatform: SourcePlatform;
  sourceFamily: SourceFamily;
  intent?: ResearchIntentInput | undefined;
}

const SHAPE_PLAN: Record<EvidenceShape, IntentEvidencePlanStep> = {
  page_text: {
    shape: "page_text",
    farmSupport: "native",
    recommendedCapture: "captureRouting:auto + page_text",
    reason: "Visible text answers articles, reviews, claims, and trend vocabulary cheaply."
  },
  page_html: {
    shape: "page_html",
    farmSupport: "native",
    recommendedCapture: "page_html + structured extractor",
    reason: "HTML preserves source layout/context and supports deterministic derived extraction."
  },
  structured_data: {
    shape: "structured_data",
    farmSupport: "native",
    recommendedCapture: "official API/readiness + JSON-LD/OpenGraph/tables/typed facts",
    reason: "Prices, dates, ratings, and metadata should come from structured or typed artifacts when available."
  },
  semi_structured_dom: {
    shape: "semi_structured_dom",
    farmSupport: "native",
    recommendedCapture: "browser-visible DOM/text/links + source registry",
    reason: "Cards, search results, tables, and iframe text are best treated as semi-structured DOM evidence."
  },
  ui_screenshot: {
    shape: "ui_screenshot",
    farmSupport: "native",
    recommendedCapture: "captureProfile:full + page_screenshot/scoped screenshot",
    reason: "Design/UI claims require visual evidence, not text-only capture."
  },
  ocr_image_text: {
    shape: "ocr_image_text",
    farmSupport: "native_opt_in",
    recommendedCapture: "ocr.enabled + screenshot/frame artifacts",
    reason: "Image-rendered prices, map labels, badges, and UI text require OCR."
  },
  video_frames: {
    shape: "video_frames",
    farmSupport: "native_opt_in",
    recommendedCapture: "sampleFrames/denseSampling + frame_screenshot",
    reason: "Visual video claims need timestamped frame screenshots."
  },
  captions_transcript: {
    shape: "captions_transcript",
    farmSupport: "native_opt_in",
    recommendedCapture: "served captions/WebVTT transcript_cue when available",
    reason: "Transcript/audio claims need a transcript artifact, not a page summary."
  },
  stt_asr: {
    shape: "stt_asr",
    farmSupport: "external_heavy",
    recommendedCapture: "leesearch-video-heavy local ASR, then register transcript bytes",
    reason: "The farm does not perform autonomous speech-to-text; heavy extraction supplies bytes for verification."
  },
  tts_detection: {
    shape: "tts_detection",
    farmSupport: "external_heavy_or_unsupported",
    recommendedCapture: "external audio-forensics/heavy path + BYO transcript/diagnostic artifact",
    reason: "Synthetic-voice detection is not a farm-native claim; keep it separate and provenance-labelled."
  },
  audio_events: {
    shape: "audio_events",
    farmSupport: "external_heavy_or_unsupported",
    recommendedCapture: "external sound-event/audio analysis + BYO registered evidence",
    reason: "Sound events, music, tone, or effects require an audio analysis path outside trusted farm capture."
  },
  map_place_state: {
    shape: "map_place_state",
    farmSupport: "native_opt_in",
    recommendedCapture: "browser-visible map/place capture + OCR + destination triage",
    reason: "Map/place claims often depend on rendered panels, labels, and selected-place state."
  },
  byte_faithful_byo: {
    shape: "byte_faithful_byo",
    farmSupport: "byo_only",
    recommendedCapture: "farm_register_evidence bytesBase64/text with captureMethod provenance",
    reason: "When a lawful external capturer or human supplies exact bytes, the farm verifies anchors instead of trusting the supplier."
  }
};

export function planIntentProfile(input: PlanIntentProfileInput): IntentProfileReport {
  const rawIntent = input.intent ?? {};
  const inferredShapes = inferShapes(input, rawIntent);
  const missing = missingIntentFields(rawIntent);
  const evidencePlan = inferredShapes.map((shape) => SHAPE_PLAN[shape]);
  const recommendedOptions = buildRecommendedOptions(inferredShapes, rawIntent);
  const status: IntentStatus = missing.length === 0 ? "locked" : rawIntent.decisionNeeded !== undefined || rawIntent.evidenceShapes !== undefined ? "provisional" : "underspecified";

  return {
    schemaVersion: "1.0",
    status,
    autonomyMode: "soft_lock",
    source: {
      url: input.url,
      platform: input.sourcePlatform,
      family: input.sourceFamily
    },
    intent: {
      decisionNeeded: rawIntent.decisionNeeded ?? "provisional: gather reusable public evidence and label missing decision intent",
      targetScope: rawIntent.targetScope ?? "provisional: target URL only; no broader source universe implied",
      evidenceShapes: rawIntent.evidenceShapes ?? inferredShapes,
      successCriteria: rawIntent.successCriteria ?? "provisional: produce grounded signals and expose gaps, not final alpha",
      boundaries: rawIntent.boundaries ?? "default: no login/paywall/CAPTCHA/payment/raw-stream bypass; use consented profile or BYO when needed"
    },
    inferredShapes,
    evidencePlan,
    recommendedOptions,
    questions: buildQuestions(missing),
    provisionalAssumptions: buildAssumptions(status, inferredShapes),
    boundaryWarnings: buildBoundaryWarnings(inferredShapes),
    efficiencyGuard: "Ask only when the missing field changes capture modality, source universe, or refusal boundary; otherwise proceed with explicit provisional assumptions.",
    flexibilityGuard: "A soft lock records intent and missing shapes without preventing later escalation to OCR, frames, heavy ASR, or BYO when evidence demands it."
  };
}

function inferShapes(input: PlanIntentProfileInput, intent: ResearchIntentInput): EvidenceShape[] {
  const shapes = new Set<EvidenceShape>(intent.evidenceShapes ?? []);
  const text = [intent.decisionNeeded, intent.targetScope, intent.successCriteria, input.url, input.sourceFamily, input.sourcePlatform]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();

  shapes.add("page_text");
  shapes.add("page_html");
  if (/price|가격|요금|cost|competitor|market|주가|시세|rating|평점|date|날짜|metadata/.test(text)) {
    shapes.add("structured_data");
  }
  if (/search|검색|card|table|dom|iframe|result|ranking|랭킹|리스트/.test(text)) {
    shapes.add("semi_structured_dom");
  }
  if (/ui|ux|design|layout|screenshot|visual|디자인|화면|캡처|캡쳐|이미지|지도|map/.test(text)) {
    shapes.add("ui_screenshot");
  }
  if (/ocr|image text|이미지.*글|가격표|badge|label|라벨|지도|map/.test(text)) {
    shapes.add("ocr_image_text");
  }
  if (/video|영상|frame|프레임|scene|장면/.test(text)) {
    shapes.add("video_frames");
  }
  if (/caption|subtitle|transcript|자막|스크립트|대본/.test(text)) {
    shapes.add("captions_transcript");
  }
  if (/stt|asr|speech|spoken|voice|음성|말소리|발화/.test(text)) {
    shapes.add("stt_asr");
  }
  if (/tts|synthetic voice|ai voice|합성음|합성 음성/.test(text)) {
    shapes.add("tts_detection");
  }
  if (/audio|sound|music|소리|음원|효과음|음악|톤/.test(text)) {
    shapes.add("audio_events");
  }
  if (/map|place|지도|장소|플레이스/.test(text)) {
    shapes.add("map_place_state");
  }
  if (/byo|profile|login|로그인|human|external|외부/.test(text)) {
    shapes.add("byte_faithful_byo");
  }
  return Array.from(shapes.values());
}

function missingIntentFields(intent: ResearchIntentInput): string[] {
  const missing: string[] = [];
  if (isBlank(intent.decisionNeeded)) {
    missing.push("decision_needed");
  }
  if (isBlank(intent.targetScope)) {
    missing.push("target_scope");
  }
  if (intent.evidenceShapes === undefined || intent.evidenceShapes.length === 0) {
    missing.push("evidence_shapes");
  }
  if (isBlank(intent.successCriteria)) {
    missing.push("success_criteria");
  }
  if (isBlank(intent.boundaries)) {
    missing.push("boundaries");
  }
  return missing;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function buildRecommendedOptions(shapes: readonly EvidenceShape[], intent: ResearchIntentInput): IntentProfileReport["recommendedOptions"] {
  const shapeSet = new Set(shapes);
  const needsVisual = shapeSet.has("ui_screenshot") || shapeSet.has("ocr_image_text") || shapeSet.has("video_frames") || shapeSet.has("map_place_state");
  const needsHeavy = shapeSet.has("stt_asr") || shapeSet.has("tts_detection") || shapeSet.has("audio_events");
  const byoAllowed = /byo|human|profile|consent|동의|수동|외부/i.test(intent.boundaries ?? "") || shapeSet.has("byte_faithful_byo");
  return {
    captureRouting: "auto",
    captureProfile: needsVisual ? "full" : "text",
    sampleFrames: shapeSet.has("video_frames"),
    ocr: shapeSet.has("ocr_image_text") || shapeSet.has("map_place_state"),
    denseSampling: shapeSet.has("video_frames") || shapeSet.has("captions_transcript") || shapeSet.has("stt_asr"),
    officialApi: shapeSet.has("structured_data"),
    heavyPath: needsHeavy,
    byoAllowed
  };
}

function buildQuestions(missing: readonly string[]): string[] {
  const questions: string[] = [];
  if (missing.includes("decision_needed")) {
    questions.push("What decision should this evidence support: alpha pick, trend watch, price compare, UI/design teardown, user-pain mining, or source verification?");
  }
  if (missing.includes("target_scope")) {
    questions.push("What target scope matters: entity/product/place/person, geography/language, time horizon, and must-include or must-exclude sources?");
  }
  if (missing.includes("evidence_shapes")) {
    questions.push("Which evidence shapes matter: text/HTML, structured prices/API, UI screenshot, OCR/image text, video frames, captions, STT/ASR, TTS/audio, map/place state, or BYO bytes?");
  }
  if (missing.includes("success_criteria")) {
    questions.push("What would count as useful or surprising enough to change your decision?");
  }
  if (missing.includes("boundaries")) {
    questions.push("Are consented profile/BYO captures allowed, and what login/paywall/CAPTCHA/raw-media boundaries must remain terminal?");
  }
  return questions;
}

function buildAssumptions(status: IntentStatus, shapes: readonly EvidenceShape[]): string[] {
  if (status === "locked") {
    return [];
  }
  return ["Continue without blocking only as a provisional run.", `Initial evidence shapes: ${shapes.join(", ")}.`, "Do not stamp ALPHA from this run unless independent corroboration, refutation, and a falsifiable prediction are later added."];
}

function buildBoundaryWarnings(shapes: readonly EvidenceShape[]): string[] {
  const warnings: string[] = [];
  if (shapes.some((shape) => shape === "stt_asr" || shape === "tts_detection" || shape === "audio_events")) {
    warnings.push("Audio/STT/TTS needs are outside farm-native autonomous capture; use heavy/BYO evidence and do not download or bypass raw audio/video streams.");
  }
  if (shapes.includes("byte_faithful_byo")) {
    warnings.push("BYO bytes must be provenance-labelled and registered exactly; the farm verifies anchors, not the external capturer.");
  }
  return warnings;
}
