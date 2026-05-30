// Small, dependency-free collection helpers consolidated from formerly-duplicated
// per-module copies (master-plan P6). Three deliberate dedupe variants preserve the
// distinct behaviors the call sites relied on, so consolidation is byte-for-byte
// behavior-preserving rather than a quiet semantic change.

/** Dedupe, preserving first-seen order. */
export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Dedupe, then sort ascending. */
export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Dedupe after dropping blank / whitespace-only entries, preserving first-seen order. */
export function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
