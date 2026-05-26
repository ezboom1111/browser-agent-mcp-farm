export interface TranscriptCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface ParsedTranscript {
  format: "webvtt";
  cueCount: number;
  text: string;
  cues: TranscriptCue[];
}

export function parseWebVtt(input: string): ParsedTranscript {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const cues: TranscriptCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || lines[0] === "WEBVTT" || lines[0]?.startsWith("NOTE")) {
      continue;
    }

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) {
      continue;
    }
    const timing = lines[timingIndex];
    if (timing === undefined) {
      continue;
    }
    const [startRaw, endWithSettingsRaw] = timing.split("-->").map((part) => part.trim());
    const endRaw = endWithSettingsRaw?.split(/\s+/, 1)[0];
    const startSec = parseTimestamp(startRaw);
    const endSec = parseTimestamp(endRaw);
    if (startSec === undefined || endSec === undefined) {
      continue;
    }
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    if (text.length === 0) {
      continue;
    }
    cues.push({ startSec, endSec, text });
  }

  return {
    format: "webvtt",
    cueCount: cues.length,
    text: cues.map((cue) => cue.text).join("\n"),
    cues
  };
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return undefined;
  }
  const secondsRaw = parts.at(-1);
  const minutesRaw = parts.at(-2);
  const hoursRaw = parts.length === 3 ? parts[0] : "0";
  if (secondsRaw === undefined || minutesRaw === undefined || hoursRaw === undefined) {
    return undefined;
  }
  const seconds = Number(secondsRaw.replace(",", "."));
  const minutes = Number(minutesRaw);
  const hours = Number(hoursRaw);
  if (![seconds, minutes, hours].every(Number.isFinite)) {
    return undefined;
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000) / 1000;
}
