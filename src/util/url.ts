// URL helpers consolidated from formerly-duplicated per-module copies (master-plan P6).

/** Parse a URL, returning undefined instead of throwing on malformed input. */
export function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}
