// Text helpers consolidated from formerly-duplicated per-module copies (master-plan P6).

/** Strip a leading UTF-8 BOM (U+FEFF) if present. */
export function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}
