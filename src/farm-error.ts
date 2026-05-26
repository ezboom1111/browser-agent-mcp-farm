export class FarmError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FarmError";
    this.code = code;
  }
}

export function toToolError(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof FarmError) {
    return { ok: false, code: error.code, message: error.message };
  }

  if (error instanceof Error) {
    return { ok: false, code: "internal_error", message: error.message };
  }

  return { ok: false, code: "internal_error", message: String(error) };
}

