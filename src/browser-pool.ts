import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Request, type Response } from "playwright";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord, type CaptureBundleInput, type MediaArtifactInput } from "./artifact-writer.js";
import { FarmError } from "./farm-error.js";
import {
  buildTimestampPlan,
  frameCaptureId,
  type FrameSample,
  type FrameSampleRunResult,
  type MediaElementSnapshot,
  type SeekResult,
  type SerializedCue
} from "./frame-sampler.js";
import { type Lease, LeaseManager } from "./lease-manager.js";
import { profilePaths, profileRoot } from "./profile-store.js";

const MAX_MEDIA_ARTIFACTS_PER_PAGE = 40;
const MAX_SINGLE_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES_PER_PAGE = 100 * 1024 * 1024;
const MEDIA_DRAIN_TIMEOUT_MS = 2_000;

interface ContextState {
  context: BrowserContext;
  pages: Map<string, PageState>;
  lease: Lease;
  persistent: boolean;
  storageStatePath?: string;
  profileLockKey?: string;
}

interface PageState {
  page: Page;
  url: string;
  consoleEvents: unknown[];
  networkEvents: unknown[];
  mediaEvents: MediaCaptureEvent[];
  pendingMediaCaptures: Set<Promise<void>>;
  capturedMediaBytes: number;
}

interface MediaCaptureEvent {
  url: string;
  mime: string;
  resourceType: string;
  httpStatus?: number;
  contentLength?: number;
  captured: boolean;
  skipped: boolean;
  reason?: string;
  at: string;
  bytes?: Uint8Array;
}

export interface BrowserPoolOptions {
  navigationTimeoutMs?: number;
  launchHeadless?: boolean;
  artifactWriter?: ArtifactWriter;
}

export class BrowserPool {
  private readonly contexts = new Map<string, ContextState>();
  private readonly leaseManager: LeaseManager;
  private readonly navigationTimeoutMs: number;
  private readonly launchHeadless: boolean;
  private readonly artifactWriter: ArtifactWriter;
  private readonly activeProfileLeases = new Map<string, string>();
  private browser: Browser | undefined;
  private browserLaunch: Promise<Browser> | undefined;

  constructor(leaseManager: LeaseManager, options: BrowserPoolOptions = {}) {
    this.leaseManager = leaseManager;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 20_000;
    this.launchHeadless = options.launchHeadless ?? true;
    this.artifactWriter = options.artifactWriter ?? new ArtifactWriter();
  }

  async openPage(agentId: string, contextToken: string, url: string): Promise<{ pageId: string; url: string; title: string }> {
    const lease = this.leaseManager.assertCanOpen(contextToken, agentId, url);
    const state = await this.ensureContext(lease);
    const page = await state.context.newPage();
    const pageId = `page_${randomUUID()}`;
    const pageState: PageState = {
      page,
      url,
      consoleEvents: [],
      networkEvents: [],
      mediaEvents: [],
      pendingMediaCaptures: new Set(),
      capturedMediaBytes: 0
    };

    attachEventCapture(pageState);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs });
      state.pages.set(pageId, pageState);
      this.leaseManager.registerPage(contextToken, agentId, pageId, url);
      return { pageId, url: page.url(), title: await page.title().catch(() => "") };
    } catch (error) {
      await page.close().catch(() => undefined);
      throw new FarmError("page_open_failed", error instanceof Error ? error.message : String(error));
    }
  }

  async capturePage(agentId: string, contextToken: string, pageId: string, captureId?: string): Promise<{ records: ArtifactRecord[] }> {
    const lease = this.leaseManager.get(contextToken, agentId);
    const pageState = this.getPageState(contextToken, pageId);
    const page = pageState.page;
    const sourceUrl = page.url() || pageState.url;

    try {
      await drainMediaCaptures(pageState);
      const [html, text, title, screenshot] = await Promise.all([
        page.content(),
        page.locator("body").innerText({ timeout: 2_000 }).catch(() => ""),
        page.title().catch(() => ""),
        page.screenshot({ fullPage: true, timeout: 10_000 })
      ]);

      const bundleInput: CaptureBundleInput = {
        runDir: lease.artifactRunDir,
        sourceUrl,
        contextToken,
        pageId,
        html,
        text,
        screenshot,
        metadata: {
          title,
          finalUrl: sourceUrl,
          originalUrl: pageState.url,
          status: "ok"
        },
        networkEvents: pageState.networkEvents,
        consoleEvents: pageState.consoleEvents
      };
      if (pageState.mediaEvents.length > 0) {
        bundleInput.mediaIndex = pageState.mediaEvents.map(toMediaIndexRow);
      }
      const mediaArtifacts = mediaArtifactsForPage(pageState);
      if (mediaArtifacts !== undefined) {
        bundleInput.mediaArtifacts = mediaArtifacts;
      }
      const records = await this.artifactWriter.writeCaptureBundle(
        captureId === undefined ? bundleInput : { ...bundleInput, captureId }
      );

      return { records };
    } catch (error) {
      const failureInput = {
        runDir: lease.artifactRunDir,
        sourceUrl,
        contextToken,
        pageId,
        error: error instanceof Error ? error.message : String(error),
        status: "error"
      } as const;
      const records = await this.artifactWriter.recordFailure(
        captureId === undefined ? failureInput : { ...failureInput, captureId }
      );
      return { records };
    }
  }

  async closePage(agentId: string, contextToken: string, pageId: string): Promise<void> {
    const pageState = this.getPageState(contextToken, pageId);
    await pageState.page.close().catch(() => undefined);
    this.contexts.get(contextToken)?.pages.delete(pageId);
    this.leaseManager.closePage(contextToken, agentId, pageId);
  }

  async click(agentId: string, contextToken: string, pageId: string, selector: string): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    await assertNotPaymentAction(pageState.page, selector);
    await pageState.page.click(selector, { timeout: 10_000 });
    return { ok: true, url: pageState.page.url() };
  }

  async fill(agentId: string, contextToken: string, pageId: string, selector: string, value: string): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    await assertNotPaymentAction(pageState.page, selector);
    await pageState.page.fill(selector, value, { timeout: 10_000 });
    return { ok: true, url: pageState.page.url() };
  }

  async press(agentId: string, contextToken: string, pageId: string, key: string): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    await assertNotPaymentAction(pageState.page);
    await pageState.page.keyboard.press(key);
    return { ok: true, url: pageState.page.url() };
  }

  async selectOption(agentId: string, contextToken: string, pageId: string, selector: string, value: string): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    await assertNotPaymentAction(pageState.page, selector);
    await pageState.page.selectOption(selector, value, { timeout: 10_000 });
    return { ok: true, url: pageState.page.url() };
  }

  async waitForPage(agentId: string, contextToken: string, pageId: string, waitMs: number): Promise<{ ok: true; url: string }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    await pageState.page.waitForTimeout(waitMs);
    return { ok: true, url: pageState.page.url() };
  }

  async waitForSelector(agentId: string, contextToken: string, pageId: string, selector: string, timeoutMs: number): Promise<{ ok: true; url: string }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    await pageState.page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
    return { ok: true, url: pageState.page.url() };
  }

  async scroll(
    agentId: string,
    contextToken: string,
    pageId: string,
    direction: "down" | "up" | "bottom" | "top",
    pixels: number
  ): Promise<{ ok: true; url: string; scrollY: number }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const scrollY = await pageState.page.evaluate(({ direction: pageDirection, pixels: pagePixels }) => {
      if (pageDirection === "top") {
        window.scrollTo(0, 0);
      } else if (pageDirection === "bottom") {
        window.scrollTo(0, document.documentElement.scrollHeight);
      } else {
        window.scrollBy(0, pageDirection === "up" ? -pagePixels : pagePixels);
      }
      return window.scrollY;
    }, { direction, pixels });
    return { ok: true, url: pageState.page.url(), scrollY };
  }

  async captureAfterIdle(
    agentId: string,
    contextToken: string,
    pageId: string,
    captureId: string | undefined,
    waitMs: number,
    idleMs: number,
    timeoutMs: number
  ): Promise<{ records: ArtifactRecord[] }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    if (waitMs > 0) {
      await pageState.page.waitForTimeout(waitMs);
    }
    await pageState.page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
    if (idleMs > 0) {
      await pageState.page.waitForTimeout(idleMs);
    }
    return this.capturePage(agentId, lease.contextToken, pageId, captureId);
  }

  async sampleFrames(
    agentId: string,
    contextToken: string,
    pageId: string,
    input: {
      selector: string;
      captureId?: string | undefined;
      timestampsSec?: number[] | undefined;
      durationSec?: number | undefined;
      strideSec: number;
      maxFrames: number;
      seekTimeoutMs: number;
      settleMs: number;
    }
  ): Promise<FrameSampleRunResult> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const page = pageState.page;
    const sourceUrl = page.url() || pageState.url;
    const baseCaptureId = sanitizeFileBase(input.captureId ?? `frame-sample-${new URL(sourceUrl).hostname}-${randomUUID()}`);
    const media = await readMediaElementSnapshot(page, input.selector);
    const plan = buildTimestampPlan({
      timestampsSec: input.timestampsSec,
      durationSec: input.durationSec ?? media.durationSec,
      strideSec: input.strideSec,
      maxFrames: input.maxFrames
    });
    const warnings: string[] = [];
    if (plan.capped) {
      warnings.push(`timestamp_plan_capped:${plan.omittedCount}`);
    }
    if (plan.timestampsSec.length === 0) {
      warnings.push("timestamp_plan_empty");
    }

    const commonInput = {
      runDir: lease.artifactRunDir,
      sourceUrl,
      contextToken,
      pageId,
      captureMethod: "browser-agent-mcp-farm frame-sample",
      toolName: "farm_sample_frames"
    };
    const summaryRecords = await this.artifactWriter.writeCaptureBundle({
      ...commonInput,
      captureId: baseCaptureId,
      metadata: {
        status: "ok",
        finalUrl: sourceUrl,
        originalUrl: pageState.url,
        frameSample: {
          selector: input.selector,
          plan,
          media,
          warnings
        }
      },
      note: "frame sample summary"
    });

    const frames: FrameSample[] = [];
    const records: ArtifactRecord[] = [...summaryRecords];
    for (const [index, timestampSec] of plan.timestampsSec.entries()) {
      const ordinal = index + 1;
      const currentCaptureId = frameCaptureId(baseCaptureId, ordinal, timestampSec);
      const seek = await seekMediaElement(page, input.selector, timestampSec, input.seekTimeoutMs);
      if (input.settleMs > 0) {
        await page.waitForTimeout(input.settleMs);
      }
      const activeCues = await readActiveCues(page, input.selector).catch(() => []);
      const frameStatus = seek.ok ? "ok" : "partial";
      try {
        const screenshot = await page.locator(input.selector).first().screenshot({ timeout: 10_000 });
        const frameRecords = await this.artifactWriter.writeCaptureBundle({
          ...commonInput,
          captureId: currentCaptureId,
          screenshot,
          status: frameStatus,
          metadata: {
            status: frameStatus,
            finalUrl: sourceUrl,
            originalUrl: pageState.url,
            frameSample: {
              selector: input.selector,
              ordinal,
              timestampSec,
              seek,
              activeCues
            }
          },
          note: seek.ok ? `frame sample at ${timestampSec}s` : `partial frame sample at ${timestampSec}s: ${seek.reason ?? "seek_failed"}`
        });
        records.push(...frameRecords);
        frames.push({
          ordinal,
          timestampSec,
          captureId: currentCaptureId,
          status: frameStatus,
          seek,
          activeCues,
          records: frameRecords
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureRecords = await this.artifactWriter.recordFailure({
          ...commonInput,
          captureId: currentCaptureId,
          error: message,
          status: "partial",
          metadata: {
            frameSample: {
              selector: input.selector,
              ordinal,
              timestampSec,
              seek,
              activeCues
            }
          },
          note: `frame screenshot failed at ${timestampSec}s: ${message}`
        });
        records.push(...failureRecords);
        frames.push({
          ordinal,
          timestampSec,
          captureId: currentCaptureId,
          status: "partial",
          seek,
          activeCues,
          records: failureRecords,
          error: message
        });
      }
    }

    const status = frames.every((frame) => frame.status === "ok") && !warnings.includes("timestamp_plan_empty") ? "ok" : "partial";
    return {
      ok: status === "ok",
      status,
      sourceUrl,
      selector: input.selector,
      captureId: baseCaptureId,
      plan,
      media,
      frames,
      records,
      warnings
    };
  }

  async releaseContext(agentId: string, contextToken: string): Promise<void> {
    this.leaseManager.release(contextToken, agentId);
    await this.closeContext(contextToken);
  }

  async closeContext(contextToken: string): Promise<void> {
    const state = this.contexts.get(contextToken);
    if (!state) {
      return;
    }
    try {
      if (state.storageStatePath) {
        await mkdir(dirname(state.storageStatePath), { recursive: true });
        await state.context.storageState({ path: state.storageStatePath, indexedDB: true }).catch(() => undefined);
      }
      await state.context.close().catch(() => undefined);
    } finally {
      if (state.profileLockKey !== undefined && this.activeProfileLeases.get(state.profileLockKey) === contextToken) {
        this.activeProfileLeases.delete(state.profileLockKey);
      }
      this.contexts.delete(contextToken);
    }
  }

  async shutdown(): Promise<void> {
    for (const token of [...this.contexts.keys()]) {
      await this.closeContext(token);
    }
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
    this.browserLaunch = undefined;
  }

  private async ensureContext(lease: Lease): Promise<ContextState> {
    const existing = this.contexts.get(lease.contextToken);
    if (existing) {
      return existing;
    }

    const storageStatePath = resolveStorageStatePath(lease);
    const profileLockKey = resolveProfileLockKey(lease);
    if (profileLockKey !== undefined) {
      const activeLease = this.activeProfileLeases.get(profileLockKey);
      if (activeLease !== undefined && activeLease !== lease.contextToken) {
        throw new FarmError("profile_in_use", `Profile or storage state is already leased by ${activeLease}: ${profileLockKey}`);
      }
      this.activeProfileLeases.set(profileLockKey, lease.contextToken);
    }

    const options = contextOptionsForLease(lease, storageStatePath);
    let context: BrowserContext;
    let persistent = false;

    try {
      if (lease.storagePolicy === "persistent-profile") {
        persistent = true;
        context = await chromium.launchPersistentContext(resolveUserDataDir(lease), {
          ...options,
          headless: this.launchHeadless
        });
      } else {
        const browser = await this.ensureBrowser();
        context = await browser.newContext(options);
      }

      const state: ContextState = { context, pages: new Map(), lease, persistent };
      if (storageStatePath !== undefined) {
        state.storageStatePath = storageStatePath;
      }
      if (profileLockKey !== undefined) {
        state.profileLockKey = profileLockKey;
      }
      this.contexts.set(lease.contextToken, state);
      return state;
    } catch (error) {
      if (profileLockKey !== undefined && this.activeProfileLeases.get(profileLockKey) === lease.contextToken) {
        this.activeProfileLeases.delete(profileLockKey);
      }
      throw error;
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }
    if (!this.browserLaunch) {
      this.browserLaunch = chromium.launch({ headless: this.launchHeadless }).then((browser) => {
        this.browser = browser;
        return browser;
      });
    }
    return this.browserLaunch;
  }

  private getPageState(contextToken: string, pageId: string): PageState {
    const state = this.contexts.get(contextToken);
    const pageState = state?.pages.get(pageId);
    if (!pageState) {
      throw new FarmError("page_not_found", `Page not found: ${pageId}`);
    }
    return pageState;
  }

  private getMutablePageState(agentId: string, contextToken: string, pageId: string): PageState {
    this.leaseManager.assertCanMutate(contextToken, agentId);
    const pageState = this.getPageState(contextToken, pageId);
    return pageState;
  }
}

function attachEventCapture(state: PageState): void {
  state.page.on("console", (message) => {
    state.consoleEvents.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
      at: new Date().toISOString()
    });
  });

  state.page.on("requestfinished", async (request) => {
    const response = await request.response().catch(() => null);
    state.networkEvents.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response?.status(),
      at: new Date().toISOString()
    });
    if (response !== null) {
      const pendingCapture = captureMediaResponse(state, request, response).finally(() => {
        state.pendingMediaCaptures.delete(pendingCapture);
      });
      state.pendingMediaCaptures.add(pendingCapture);
    }
  });

  state.page.on("requestfailed", (request) => {
    state.networkEvents.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText,
      at: new Date().toISOString()
    });
  });
}

async function readMediaElementSnapshot(page: Page, selector: string): Promise<MediaElementSnapshot> {
  return page.locator(selector).first().evaluate((node) => {
    const media = node as HTMLMediaElement;
    const durationSec = Number.isFinite(media.duration) && media.duration >= 0 ? media.duration : undefined;
    const currentTimeSec = Number.isFinite(media.currentTime) && media.currentTime >= 0 ? media.currentTime : undefined;
    return {
      ...(durationSec === undefined ? {} : { durationSec }),
      ...(currentTimeSec === undefined ? {} : { currentTimeSec }),
      readyState: media.readyState,
      paused: media.paused,
      textTracks: Array.from(media.textTracks ?? []).map((track) => ({
        kind: track.kind,
        label: track.label,
        language: track.language,
        mode: track.mode,
        cues: serializeCues(track.cues),
        activeCues: serializeCues(track.activeCues)
      })),
      trackElements: Array.from(media.querySelectorAll("track")).map((track) => {
        const element = track as HTMLTrackElement;
        return {
          kind: element.kind,
          label: element.label,
          srclang: element.srclang,
          src: element.src,
          readyState: element.readyState,
          default: element.default
        };
      })
    };

    function serializeCues(cues: TextTrackCueList | null): Array<{ startTime: number; endTime: number; text: string }> {
      if (cues === null) {
        return [];
      }
      return Array.from(cues).map((cue) => ({
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: "text" in cue ? String(cue.text) : ""
      }));
    }
  });
}

async function seekMediaElement(page: Page, selector: string, timestampSec: number, timeoutMs: number): Promise<SeekResult> {
  return page.locator(selector).first().evaluate(async (node, args) => {
    const media = node as HTMLMediaElement;
    const requestedTimestampSec = args.timestampSec;
    const durationSec = Number.isFinite(media.duration) && media.duration >= 0 ? media.duration : undefined;
    if (durationSec !== undefined && requestedTimestampSec > durationSec) {
      return {
        ok: false,
        requestedTimestampSec,
        currentTimeSec: media.currentTime,
        durationSec,
        reason: "timestamp_beyond_duration"
      };
    }

    if (typeof media.pause === "function") {
      media.pause();
    }

    return new Promise<SeekResult>((resolvePromise) => {
      let done = false;
      const finish = (ok: boolean, reason?: string): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        media.removeEventListener("seeked", onSeeked);
        const currentTimeSec = Number.isFinite(media.currentTime) ? media.currentTime : undefined;
        resolvePromise({
          ok,
          requestedTimestampSec,
          ...(currentTimeSec === undefined ? {} : { currentTimeSec }),
          ...(durationSec === undefined ? {} : { durationSec }),
          ...(reason === undefined ? {} : { reason })
        });
      };
      const onSeeked = (): void => finish(true);
      const timer = setTimeout(() => {
        const closeEnough = Number.isFinite(media.currentTime) && Math.abs(media.currentTime - requestedTimestampSec) < 0.25;
        finish(closeEnough, closeEnough ? undefined : "seek_timeout");
      }, args.timeoutMs);

      media.addEventListener("seeked", onSeeked, { once: true });
      try {
        media.currentTime = requestedTimestampSec;
        setTimeout(() => {
          if (Number.isFinite(media.currentTime) && Math.abs(media.currentTime - requestedTimestampSec) < 0.25) {
            finish(true);
          }
        }, 100);
      } catch (error) {
        finish(false, `seek_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }, { timestampSec, timeoutMs });
}

async function readActiveCues(page: Page, selector: string): Promise<SerializedCue[]> {
  return page.locator(selector).first().evaluate((node) => {
    const media = node as HTMLMediaElement;
    return Array.from(media.textTracks ?? []).flatMap((track) => {
      const cues = track.activeCues;
      if (cues === null) {
        return [];
      }
      return Array.from(cues).map((cue) => ({
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: "text" in cue ? String(cue.text) : ""
      }));
    });
  });
}

async function captureMediaResponse(state: PageState, request: Request, response: Response): Promise<void> {
  const headers = response.headers();
  const mime = normalizeMime(headers["content-type"]);
  const resourceType = request.resourceType();
  const contentLength = parseContentLength(headers["content-length"]);
  if (!isMediaLike(resourceType, mime, request.url())) {
    return;
  }

  const event: MediaCaptureEvent = {
    url: request.url(),
    mime,
    resourceType,
    httpStatus: response.status(),
    captured: false,
    skipped: false,
    at: new Date().toISOString()
  };
  if (contentLength !== undefined) {
    event.contentLength = contentLength;
  }
  state.mediaEvents.push(event);

  const skipReason = mediaSkipReason(state, event);
  if (skipReason !== undefined) {
    event.skipped = true;
    event.reason = skipReason;
    return;
  }

  try {
    const bytes = await response.body();
    if (bytes.byteLength > MAX_SINGLE_MEDIA_BYTES) {
      event.skipped = true;
      event.reason = "media_larger_than_single_artifact_limit";
      event.contentLength = bytes.byteLength;
      return;
    }
    if (state.capturedMediaBytes + bytes.byteLength > MAX_TOTAL_MEDIA_BYTES_PER_PAGE) {
      event.skipped = true;
      event.reason = "media_larger_than_page_total_limit";
      event.contentLength = bytes.byteLength;
      return;
    }
    event.bytes = bytes;
    event.contentLength = bytes.byteLength;
    event.captured = true;
    state.capturedMediaBytes += bytes.byteLength;
  } catch (error) {
    event.skipped = true;
    event.reason = `media_body_unavailable:${error instanceof Error ? error.message : String(error)}`;
  }
}

async function drainMediaCaptures(state: PageState): Promise<void> {
  const pending = [...state.pendingMediaCaptures];
  if (pending.length === 0) {
    return;
  }
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolvePromise) => setTimeout(resolvePromise, MEDIA_DRAIN_TIMEOUT_MS))
  ]);
}

function mediaArtifactsForPage(state: PageState): MediaArtifactInput[] | undefined {
  const artifacts = state.mediaEvents
    .filter((event): event is MediaCaptureEvent & { bytes: Uint8Array } => event.bytes !== undefined)
    .map((event) => ({
      url: event.url,
      bytes: event.bytes,
      mime: event.mime,
      resourceType: event.resourceType
    }));
  return artifacts.length > 0 ? artifacts : undefined;
}

function toMediaIndexRow(event: MediaCaptureEvent): Omit<MediaCaptureEvent, "bytes"> {
  const { bytes: _bytes, ...row } = event;
  return row;
}

function normalizeMime(contentType: string | undefined): string {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isMediaLike(resourceType: string, mime: string, url: string): boolean {
  if (["image", "media"].includes(resourceType)) {
    return true;
  }
  if (mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime === "text/vtt") {
    return true;
  }
  return /\.(vtt|srt|m3u8|mpd)(\?|#|$)/i.test(url);
}

function mediaSkipReason(state: PageState, event: MediaCaptureEvent): string | undefined {
  if (!isCapturableMedia(event.mime)) {
    return "non_capturable_stream_or_binary_media";
  }
  if (state.mediaEvents.filter((item) => item.captured).length >= MAX_MEDIA_ARTIFACTS_PER_PAGE) {
    return "media_artifact_count_limit";
  }
  if (event.contentLength !== undefined && event.contentLength > MAX_SINGLE_MEDIA_BYTES) {
    return "media_larger_than_single_artifact_limit";
  }
  if (event.contentLength !== undefined && state.capturedMediaBytes + event.contentLength > MAX_TOTAL_MEDIA_BYTES_PER_PAGE) {
    return "media_larger_than_page_total_limit";
  }
  return undefined;
}

function isCapturableMedia(mime: string): boolean {
  return mime.startsWith("image/") || mime === "text/vtt";
}

function contextOptionsForLease(lease: Lease, storageStatePath?: string): BrowserContextOptions {
  const options: BrowserContextOptions = {};
  if (lease.proxy !== undefined) {
    const proxy: NonNullable<BrowserContextOptions["proxy"]> = { server: lease.proxy.server };
    if (lease.proxy.username !== undefined) {
      proxy.username = lease.proxy.username;
    }
    if (lease.proxy.password !== undefined) {
      proxy.password = lease.proxy.password;
    }
    options.proxy = proxy;
  }
  if (lease.fingerprint?.userAgent !== undefined) {
    options.userAgent = lease.fingerprint.userAgent;
  }
  if (lease.fingerprint?.locale !== undefined) {
    options.locale = lease.fingerprint.locale;
  }
  if (lease.fingerprint?.timezoneId !== undefined) {
    options.timezoneId = lease.fingerprint.timezoneId;
  }
  if (lease.fingerprint?.viewport !== undefined) {
    options.viewport = lease.fingerprint.viewport;
  }
  if (lease.fingerprint?.colorScheme !== undefined) {
    options.colorScheme = lease.fingerprint.colorScheme;
  }
  if (lease.storagePolicy === "storage-state" && storageStatePath !== undefined && existsSync(storageStatePath)) {
    options.storageState = storageStatePath;
  }
  return options;
}

function resolveStorageStatePath(lease: Lease): string | undefined {
  if (lease.storagePolicy === "ephemeral") {
    return undefined;
  }
  if (lease.storageStatePath !== undefined) {
    return resolve(lease.storageStatePath);
  }
  if (lease.profileName !== undefined) {
    return profilePaths(lease.profileName).storageStatePath;
  }
  return undefined;
}

function resolveUserDataDir(lease: Lease): string {
  if (lease.userDataDir !== undefined) {
    return resolve(lease.userDataDir);
  }
  if (lease.profileName !== undefined) {
    return profilePaths(lease.profileName).userDataDir;
  }
  return resolve(profileRoot(), sanitizeFileBase(lease.contextToken), "user-data");
}

function resolveProfileLockKey(lease: Lease): string | undefined {
  if (lease.profileName !== undefined) {
    return `profile:${sanitizeFileBase(lease.profileName)}`;
  }
  if (lease.storageStatePath !== undefined) {
    return `storage-state:${resolve(lease.storageStatePath)}`;
  }
  if (lease.userDataDir !== undefined) {
    return `user-data:${resolve(lease.userDataDir)}`;
  }
  if (lease.storagePolicy === "persistent-profile") {
    return `user-data:${resolveUserDataDir(lease)}`;
  }
  return undefined;
}

async function assertNotPaymentAction(page: Page, selector?: string): Promise<void> {
  const candidates = [page.url(), selector ?? ""];
  if (selector !== undefined) {
    const locator = page.locator(selector).first();
    const elementSignals = await Promise.all([
      locator.innerText({ timeout: 500 }).catch(() => ""),
      locator.getAttribute("aria-label", { timeout: 500 }).catch(() => ""),
      locator.getAttribute("name", { timeout: 500 }).catch(() => ""),
      locator.getAttribute("id", { timeout: 500 }).catch(() => ""),
      locator.getAttribute("placeholder", { timeout: 500 }).catch(() => ""),
      locator.getAttribute("value", { timeout: 500 }).catch(() => "")
    ]);
    candidates.push(...elementSignals.filter((value): value is string => value !== null && value.length > 0));
  } else {
    candidates.push(await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) {
        return "";
      }
      const htmlElement = element as HTMLElement;
      return [
        htmlElement.innerText,
        htmlElement.getAttribute("aria-label"),
        htmlElement.getAttribute("name"),
        htmlElement.getAttribute("id"),
        htmlElement.getAttribute("placeholder"),
        htmlElement.getAttribute("value")
      ].filter(Boolean).join(" ");
    }).catch(() => ""));
  }

  const matched = candidates.map((value) => value.toLowerCase()).find((value) => containsPaymentSignal(value));
  if (matched !== undefined) {
    throw new FarmError("payment_guard_blocked", `Write action blocked on payment-like surface: ${page.url()}`);
  }
}

function containsPaymentSignal(value: string): boolean {
  const blocked = [
    "checkout",
    "payment",
    "billing",
    "credit-card",
    "credit card",
    "card-number",
    "card number",
    "cvc",
    "cvv",
    "expiry",
    "pay.",
    "pay-",
    "pay_",
    "pay now",
    "결제",
    "카드"
  ];
  return blocked.some((token) => value.includes(token));
}
