export class EvidenceRunAbortError extends Error {
  constructor(message = "evidence run canceled") {
    super(message);
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

export async function withAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return await work;
  }
  throwIfAborted(signal);
  let removeAbortListener: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    const listener = () => reject(abortError(signal));
    signal.addEventListener("abort", listener, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([work, abort]);
  } finally {
    removeAbortListener?.();
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof EvidenceRunAbortError || (error instanceof DOMException && error.name === "AbortError") || (typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError");
}

function abortError(signal: AbortSignal): EvidenceRunAbortError {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return new EvidenceRunAbortError(reason.message);
  }
  if (typeof reason === "string" && reason.length > 0) {
    return new EvidenceRunAbortError(reason);
  }
  return new EvidenceRunAbortError();
}
