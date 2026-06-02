import { createHash } from "node:crypto";

// Capture transcript (origin-binding Phase 0, opt-in FARM_CAPTURE_TRANSCRIPT=1). A deterministic,
// capturer-attested record of the HTTP responses a capture was assembled from — per-response
// {url, status, contentType, bodySha256} plus the final page-body digest and a binding to the registered
// page artifact. The claim gate cross-checks that the transcript's bound digest equals the registered
// page artifact's sha256: an INTERNAL-CONSISTENCY check that catches a transcript desynced from the bytes
// (and only ever ADDS an error — it can never raise a gate verdict, so the 0-leak fuzzer property holds).
//
// HONESTY (no theater): this is CAPTURER-ATTESTED, NOT origin-proven. By TLS deniability (symmetric
// session keys) a client-only capture can fabricate a self-consistent transcript after the fact, so a
// producer that controls the bytes can write both the bytes and their digest. It does NOT prove origin X
// sent these bytes. Origin-binding requires a neutral notary in the live TLS session (the deferred
// NotaryClient seam). See docs/ORIGIN_BINDING_DESIGN.md.

/** Discriminator so the gate can tell the transcript body apart from the bundle's metadata sidecar. */
export const CAPTURE_TRANSCRIPT_SCHEMA = "capture_transcript/1";

export function captureTranscriptEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FARM_CAPTURE_TRANSCRIPT === "1";
}

export interface TranscriptResponse {
  url: string;
  status: number;
  contentType?: string;
  bodySha256?: string;
  redirectLocation?: string;
}

export interface CaptureTranscript {
  schema: typeof CAPTURE_TRANSCRIPT_SCHEMA;
  finalUrl: string;
  /** sha256 of the final page body the capture was assembled from (should equal `binds.sha256`). */
  pageBodySha256: string;
  responses: TranscriptResponse[];
  /** The registered page artifact this transcript is bound to; the gate cross-checks the digest. */
  binds: { path: string; sha256: string };
  /** Optional transport provenance carried alongside (same-connection TLS / cert identity). */
  certIdentity?: Record<string, unknown>;
  note: string;
}

const TRANSCRIPT_NOTE =
  "Capturer-attested transcript: the capturer asserts these are the HTTP responses it received, and the page-body digest is verified by the gate to match the registered page artifact's bytes. This is INTERNAL CONSISTENCY, NOT origin proof — by TLS deniability a client that controls the bytes can write a self-consistent transcript after the fact. It does NOT prove origin X sent these bytes; origin-binding needs a neutral notary in the live TLS session (deferred).";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Build a capturer-attested transcript bound to the registered page artifact. Pure + deterministic. */
export function buildCaptureTranscript(input: { finalUrl: string; pageBody: string; responses: TranscriptResponse[]; binds: { path: string; sha256: string }; certIdentity?: Record<string, unknown> }): CaptureTranscript {
  const transcript: CaptureTranscript = {
    schema: CAPTURE_TRANSCRIPT_SCHEMA,
    finalUrl: input.finalUrl,
    pageBodySha256: sha256Hex(input.pageBody),
    responses: input.responses,
    binds: input.binds,
    note: TRANSCRIPT_NOTE
  };
  if (input.certIdentity !== undefined) {
    transcript.certIdentity = input.certIdentity;
  }
  return transcript;
}
