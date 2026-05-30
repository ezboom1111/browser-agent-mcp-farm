import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Frame, type Page, type Request, type Response } from "playwright";
import { isAbortError, throwIfAborted, withAbort } from "./abort.js";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord, type CaptureBundleInput, type MediaArtifactInput } from "./artifact-writer.js";
import { FarmError } from "./farm-error.js";
import {
  buildTimestampPlan,
  frameCaptureId,
  type FrameSample,
  type FrameSampleRunResult,
  type FrameVisualFingerprint,
  type MediaElementSnapshot,
  type SeekResult,
  type SerializedCue
} from "./frame-sampler.js";
import { type Lease, LeaseManager } from "./lease-manager.js";
import { profilePaths, profileRoot } from "./profile-store.js";
import { acquireProfileLock, releaseProfileLock, type ProfileLockHandle } from "./profile-lock.js";

const MAX_MEDIA_ARTIFACTS_PER_PAGE = 40;
const MAX_SINGLE_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES_PER_PAGE = 100 * 1024 * 1024;
const MEDIA_DRAIN_TIMEOUT_MS = 2_000;
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const DESTINATION_ATTRIBUTE_NAMES = [
  "data-href",
  "data-url",
  "data-link",
  "data-link-url",
  "data-target-url",
  "data-destination-url",
  "data-original-url",
  "data-canonical-url",
  "data-place-url",
  "data-source-url",
  "data-item-url",
  "data-product-url",
  "data-travel-url",
  "data-hotel-url",
  "data-offer-url",
  "data-review-url",
  "data-seller-url",
  "data-brand-url",
  "data-profile-url",
  "data-channel-url",
  "data-media-url"
] as const;
const DESTINATION_ATTRIBUTE_SELECTOR = DESTINATION_ATTRIBUTE_NAMES.map((name) => `[${name}]`).join(",");

interface ContextState {
  context: BrowserContext;
  pages: Map<string, PageState>;
  lease: Lease;
  persistent: boolean;
  storageStatePath?: string;
  profileLockKey?: string;
  profileLock?: ProfileLockHandle;
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
  browserChannel?: string;
  artifactWriter?: ArtifactWriter;
}

export interface BrowserActionOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserLinkTarget {
  index: number;
  url: string;
  text: string;
  elementIndex: number;
  source?: "anchor" | "attribute";
  attributeName?: string;
  frameIndex?: number;
  frameUrl?: string;
  frameName?: string;
}

export interface BrowserLinkTargetsResult {
  ok: true;
  url: string;
  links: BrowserLinkTarget[];
  rawCandidateCount: number;
  usableCandidateCount: number;
  uniqueCandidateCount: number;
  duplicateCandidateCount: number;
  omittedDuplicateCount: number;
  anchorCandidateCount: number;
  attributeCandidateCount: number;
  frameCount?: number;
  matchedFrameCount?: number;
}

export interface BrowserClientStateFrame {
  frameIndex: number;
  frameUrl: string;
  frameName?: string;
  found: boolean;
  truncated: boolean;
  json?: string;
  error?: string;
}

export interface BrowserClientStateResult {
  ok: true;
  url: string;
  propertyName: string;
  frameCount: number;
  matchedFrameCount: number;
  frames: BrowserClientStateFrame[];
}

export interface BrowserSelectorInspectionMatch {
  index: number;
  tagName: string;
  visible: boolean;
  textSnippet: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  href?: string;
  frameIndex?: number;
  frameUrl?: string;
  frameName?: string;
}

export interface BrowserSelectorInspection {
  ok: true;
  url: string;
  selector: string;
  matchCount: number;
  inspectedCount: number;
  visibleCount: number;
  firstTextSnippet?: string;
  firstVisibleTextSnippet?: string;
  frameCount?: number;
  matchedFrameCount?: number;
  visibleFrameCount?: number;
  matches: BrowserSelectorInspectionMatch[];
}

export type BrowserOverlayDismissalKind =
  | "cookie_consent"
  | "app_banner"
  | "newsletter_prompt"
  | "modal_close"
  | "generic_overlay";

export interface BrowserOverlayDismissalAction {
  kind: BrowserOverlayDismissalKind;
  label: string;
  status: "dismissed" | "skipped" | "error";
  reason?: string;
}

export interface BrowserOverlayDismissalReport {
  status: "clear" | "dismissed" | "partial" | "skipped";
  dismissedCount: number;
  skippedCount: number;
  actions: BrowserOverlayDismissalAction[];
  warnings: string[];
}

export class BrowserPool {
  private readonly contexts = new Map<string, ContextState>();
  private readonly leaseManager: LeaseManager;
  private readonly navigationTimeoutMs: number;
  private readonly launchHeadless: boolean;
  private readonly browserChannel: string | undefined;
  private readonly artifactWriter: ArtifactWriter;
  private readonly activeProfileLeases = new Map<string, string>();
  private browser: Browser | undefined;
  private browserLaunch: Promise<Browser> | undefined;

  constructor(leaseManager: LeaseManager, options: BrowserPoolOptions = {}) {
    this.leaseManager = leaseManager;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 20_000;
    this.launchHeadless = options.launchHeadless ?? true;
    this.browserChannel = normalizeBrowserChannel(options.browserChannel);
    this.artifactWriter = options.artifactWriter ?? new ArtifactWriter();
  }

  async openPage(agentId: string, contextToken: string, url: string, signal?: AbortSignal): Promise<{ pageId: string; url: string; title: string }> {
    throwIfAborted(signal);
    const lease = this.leaseManager.assertCanOpen(contextToken, agentId, url);
    const state = await this.ensureContext(lease);
    throwIfAborted(signal);
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
      await withAbort(page.goto(url, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs }), signal);
      state.pages.set(pageId, pageState);
      this.leaseManager.registerPage(contextToken, agentId, pageId, url);
      return { pageId, url: page.url(), title: await page.title().catch(() => "") };
    } catch (error) {
      await page.close().catch(() => undefined);
      throw new FarmError("page_open_failed", error instanceof Error ? error.message : String(error));
    }
  }

  async capturePage(agentId: string, contextToken: string, pageId: string, captureId?: string, signal?: AbortSignal): Promise<{ records: ArtifactRecord[] }> {
    throwIfAborted(signal);
    const lease = this.leaseManager.get(contextToken, agentId);
    const pageState = this.getPageState(contextToken, pageId);
    const page = pageState.page;
    const sourceUrl = page.url() || pageState.url;

    try {
      await drainMediaCaptures(pageState, signal);
      throwIfAborted(signal);
      const [html, visibleText, title, screenshot, visibleLinks] = await withAbort(Promise.all([
        page.content(),
        collectVisibleFrameText(page, sourceUrl),
        page.title().catch(() => ""),
        page.screenshot({ fullPage: true, timeout: 10_000 }),
        collectVisibleLinks(page, sourceUrl)
      ]), signal);

      const bundleInput: CaptureBundleInput = {
        runDir: lease.artifactRunDir,
        sourceUrl,
        contextToken,
        pageId,
        html,
        text: visibleText.text,
        screenshot,
        metadata: {
          title,
          finalUrl: sourceUrl,
          originalUrl: pageState.url,
          status: "ok",
          visibleTextFrames: visibleText.metadata,
          ...(visibleLinks.length === 0 ? {} : { visibleLinks })
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
      const records = await withAbort(this.artifactWriter.writeCaptureBundle(
        captureId === undefined ? bundleInput : { ...bundleInput, captureId }
      ), signal);

      return { records };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
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

  async captureLocator(agentId: string, contextToken: string, pageId: string, selector: string, captureId?: string, signal?: AbortSignal): Promise<{ records: ArtifactRecord[] }> {
    throwIfAborted(signal);
    const lease = this.leaseManager.get(contextToken, agentId);
    const pageState = this.getPageState(contextToken, pageId);
    const page = pageState.page;
    const sourceUrl = page.url() || pageState.url;

    try {
      const locator = page.locator(selector).first();
      await withAbort(locator.waitFor({ state: "visible", timeout: 10_000 }), signal);
      const [html, text, screenshot] = await withAbort(Promise.all([
        locator.evaluate((element) => (element as HTMLElement).outerHTML).catch(() => ""),
        locator.innerText({ timeout: 2_000 }).catch(() => ""),
        locator.screenshot({ timeout: 10_000 })
      ]), signal);

      const bundleInput: CaptureBundleInput = {
        runDir: lease.artifactRunDir,
        sourceUrl,
        contextToken,
        pageId,
        html,
        text,
        screenshot,
        metadata: {
          selector,
          finalUrl: sourceUrl,
          originalUrl: pageState.url,
          status: "ok"
        },
        captureMethod: "browser-agent-mcp-farm scoped-capture",
        toolName: "farm_capture_scope"
      };
      const records = await withAbort(this.artifactWriter.writeCaptureBundle(
        captureId === undefined ? bundleInput : { ...bundleInput, captureId }
      ), signal);
      return { records };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const failureInput = {
        runDir: lease.artifactRunDir,
        sourceUrl,
        contextToken,
        pageId,
        error: error instanceof Error ? error.message : String(error),
        status: "error",
        metadata: { selector, stage: "scoped_capture" },
        captureMethod: "browser-agent-mcp-farm scoped-capture",
        toolName: "farm_capture_scope"
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

  async click(agentId: string, contextToken: string, pageId: string, selector: string, options: BrowserActionOptions = {}): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    const timeout = actionTimeoutMs(options);
    await withAbort(assertNotPaymentAction(pageState.page, selector), options.signal);
    await withAbort(pageState.page.click(selector, { timeout }), options.signal);
    return { ok: true, url: pageState.page.url() };
  }

  async fill(agentId: string, contextToken: string, pageId: string, selector: string, value: string, options: BrowserActionOptions = {}): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    const timeout = actionTimeoutMs(options);
    await withAbort(assertNotPaymentAction(pageState.page, selector), options.signal);
    await withAbort(pageState.page.fill(selector, value, { timeout }), options.signal);
    return { ok: true, url: pageState.page.url() };
  }

  async press(agentId: string, contextToken: string, pageId: string, key: string, options: BrowserActionOptions = {}): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    await withAbort(assertNotPaymentAction(pageState.page), options.signal);
    await withAbort(pageState.page.keyboard.press(key), options.signal);
    return { ok: true, url: pageState.page.url() };
  }

  async selectOption(agentId: string, contextToken: string, pageId: string, selector: string, value: string, options: BrowserActionOptions = {}): Promise<{ ok: true; url: string }> {
    const pageState = this.getMutablePageState(agentId, contextToken, pageId);
    const timeout = actionTimeoutMs(options);
    await withAbort(assertNotPaymentAction(pageState.page, selector), options.signal);
    await withAbort(pageState.page.selectOption(selector, value, { timeout }), options.signal);
    return { ok: true, url: pageState.page.url() };
  }

  async waitForPage(agentId: string, contextToken: string, pageId: string, waitMs: number, signal?: AbortSignal): Promise<{ ok: true; url: string }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    await abortableDelay(waitMs, signal);
    return { ok: true, url: pageState.page.url() };
  }

  async waitForSelector(agentId: string, contextToken: string, pageId: string, selector: string, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: true; url: string }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    await withAbort(pageState.page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs }), signal);
    return { ok: true, url: pageState.page.url() };
  }

  async readVisibleText(agentId: string, contextToken: string, pageId: string, selector = "body", timeoutMs = 2_000, signal?: AbortSignal): Promise<{ ok: true; url: string; text: string }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const locator = pageState.page.locator(selector).first();
    await withAbort(locator.waitFor({ state: "visible", timeout: timeoutMs }), signal);
    const text = await withAbort(locator.innerText({ timeout: timeoutMs }), signal);
    return { ok: true, url: pageState.page.url(), text };
  }

  async readLinkTarget(agentId: string, contextToken: string, pageId: string, selector: string, timeoutMs = 2_000, signal?: AbortSignal): Promise<{ ok: true; url: string; text: string }> {
    const result = await this.readLinkTargets(agentId, contextToken, pageId, selector, 1, timeoutMs, signal);
    const target = result.links[0];
    if (target === undefined) {
      throw new FarmError("link_target_invalid", `No usable follow-up link target found for selector: ${selector}`);
    }
    return { ok: true, url: target.url, text: target.text };
  }

  async readClientState(
    agentId: string,
    contextToken: string,
    pageId: string,
    propertyName: string,
    maxJsonLength = 2_000_000,
    signal?: AbortSignal
  ): Promise<BrowserClientStateResult> {
    if (!isSafeWindowPropertyName(propertyName)) {
      throw new FarmError("client_state_property_invalid", `Client state property must be a plain window property name: ${propertyName}`);
    }
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const currentUrl = pageState.page.url() || pageState.url;
    const normalizedMaxJsonLength = Math.max(1_000, Math.min(5_000_000, maxJsonLength));
    const frames = pageState.page.frames();
    const frameResults = await withAbort(Promise.all(frames.map(async (frame, frameIndex): Promise<BrowserClientStateFrame> => {
      const frameUrl = frame.url() || currentUrl;
      const frameName = frame.name();
      try {
        const result = await frame.evaluate((args) => {
          const globalObject = window as unknown as Record<string, unknown>;
          const value = globalObject[args.propertyName];
          if (value === undefined) {
            return { found: false, truncated: false };
          }
          const json = JSON.stringify(value);
          if (json === undefined) {
            return { found: true, truncated: false, error: "client state value is not JSON serializable" };
          }
          return {
            found: true,
            truncated: json.length > args.maxJsonLength,
            json: json.length > args.maxJsonLength ? json.slice(0, args.maxJsonLength) : json
          };
        }, { propertyName, maxJsonLength: normalizedMaxJsonLength });
        return {
          frameIndex,
          frameUrl,
          ...(frameName.length === 0 ? {} : { frameName }),
          found: result.found,
          truncated: result.truncated,
          ...(result.json === undefined ? {} : { json: result.json }),
          ...(result.error === undefined ? {} : { error: result.error })
        };
      } catch (error) {
        return {
          frameIndex,
          frameUrl,
          ...(frameName.length === 0 ? {} : { frameName }),
          found: false,
          truncated: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })), signal);
    return {
      ok: true,
      url: currentUrl,
      propertyName,
      frameCount: frames.length,
      matchedFrameCount: frameResults.filter((result) => result.found).length,
      frames: frameResults
    };
  }

  async discoverLinkTargets(agentId: string, contextToken: string, pageId: string, maxLinks = 25, signal?: AbortSignal): Promise<BrowserLinkTargetsResult> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const currentUrl = pageState.page.url() || pageState.url;
    const normalizedMaxLinks = Math.max(1, Math.min(100, maxLinks));
    const frames = pageState.page.frames();
    const perFrameTargets = await withAbort(Promise.all(frames.map(async (frame, frameIndex) => {
      const baseUrl = frame.url() || currentUrl;
      try {
        const frameTargets = await frame.locator(`a, ${DESTINATION_ATTRIBUTE_SELECTOR}`).evaluateAll((elements, args) => {
          let currentWithoutHash = "";
          try {
            const currentUrl = new URL(args.baseUrl);
            currentWithoutHash = `${currentUrl.origin}${currentUrl.pathname}${currentUrl.search}`;
          } catch {
            currentWithoutHash = "";
          }
          const candidates: Array<{ href: string; text: string; visible: boolean; valid: boolean; elementIndex: number; source: "anchor" | "attribute"; attributeName?: string }> = [];
          const seenAttributeCandidates = new Set<string>();
          const visible = (element: Element): boolean => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity || "1") > 0;
          };
          const textFor = (element: Element): string => {
            const imageAlt = element.querySelector("img")?.getAttribute("alt") ?? "";
            const textParts = [
              element.textContent,
              element.getAttribute("aria-label"),
              element.getAttribute("title"),
              element.getAttribute("data-title"),
              element.getAttribute("data-name"),
              imageAlt
            ].map((value) => (value ?? "").replace(/\s+/g, " ").trim()).filter((value) => value.length > 0);
            return textParts[0] ?? "";
          };
          const addCandidate = (
            rawHref: string,
            element: Element,
            elementIndex: number,
            source: "anchor" | "attribute",
            attributeName?: string
          ): boolean => {
            let hrefValue = "";
            try {
              hrefValue = new URL(rawHref, args.baseUrl).href;
            } catch {
              hrefValue = rawHref;
            }
            const text = textFor(element);
            const isVisible = visible(element);
            let valid = false;
            try {
              const href = new URL(hrefValue);
              const hrefWithoutHash = `${href.origin}${href.pathname}${href.search}`;
              valid = isVisible &&
                (href.protocol === "http:" || href.protocol === "https:") &&
                (source === "anchor" || text.length > 0) &&
                (currentWithoutHash.length === 0 || hrefWithoutHash !== currentWithoutHash);
            } catch {
              valid = false;
            }
            candidates.push({
              href: hrefValue,
              text,
              visible: isVisible,
              valid,
              elementIndex,
              source,
              ...(attributeName === undefined ? {} : { attributeName })
            });
            return candidates.length >= args.maxCandidates;
          };
          for (const [elementIndex, element] of elements.slice(0, args.maxElements).entries()) {
            if (element instanceof HTMLAnchorElement) {
              if (addCandidate(element.href, element, elementIndex, "anchor")) {
                return candidates;
              }
              continue;
            }
            for (const attributeName of args.destinationAttributeNames) {
              const rawValue = element.getAttribute(attributeName)?.trim();
              if (rawValue === undefined || rawValue.length === 0) {
                continue;
              }
              const key = `${elementIndex}:${attributeName}:${rawValue}`;
              if (seenAttributeCandidates.has(key)) {
                continue;
              }
              seenAttributeCandidates.add(key);
              if (addCandidate(rawValue, element, elementIndex, "attribute", attributeName)) {
                return candidates;
              }
            }
          }
          return candidates;
        }, {
          baseUrl,
          maxElements: 300,
          maxCandidates: Math.max(normalizedMaxLinks * 10, normalizedMaxLinks),
          destinationAttributeNames: DESTINATION_ATTRIBUTE_NAMES
        });
        return frameTargets.map((target) => ({
          ...target,
          frameIndex,
          frameUrl: baseUrl,
          frameName: frame.name()
        }));
      } catch {
        return [];
      }
    })), signal);
    return linkTargetsResultFromCandidates({
      currentUrl,
      targets: perFrameTargets.flat(),
      normalizedMaxLinks,
      frameCount: frames.length,
      matchedFrameCount: perFrameTargets.filter((targets) => targets.length > 0).length
    });
  }

  async readLinkTargets(agentId: string, contextToken: string, pageId: string, selector: string, maxLinks = 10, timeoutMs = 2_000, signal?: AbortSignal): Promise<BrowserLinkTargetsResult> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const currentUrl = pageState.page.url() || pageState.url;
    const normalizedMaxLinks = Math.max(1, Math.min(50, maxLinks));
    const frames = pageState.page.frames();
    const visibleFrames = await framesWithVisibleSelector(frames, selector, timeoutMs, signal);
    if (visibleFrames.length === 0) {
      throw new FarmError("selector_not_visible", `No visible selector found for link extraction: ${selector}`);
    }
    const perFrameTargets = await withAbort(Promise.all(visibleFrames.map(async (frameInfo) => {
      const baseUrl = frameInfo.frame.url() || currentUrl;
      try {
        const frameTargets = await frameInfo.frame.locator(selector).evaluateAll((elements, args) => {
        let currentWithoutHash = "";
        try {
          const currentUrl = new URL(args.baseUrl);
          currentWithoutHash = `${currentUrl.origin}${currentUrl.pathname}${currentUrl.search}`;
        } catch {
          currentWithoutHash = "";
        }
        const candidates: Array<{ href: string; text: string; visible: boolean; valid: boolean; elementIndex: number; source: "anchor" | "attribute"; attributeName?: string }> = [];
        const seen = new Set<HTMLAnchorElement>();
        const seenAttributeCandidates = new Set<string>();
        const visible = (element: Element): boolean => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0;
        };
        const textFor = (element: Element): string => {
          const imageAlt = element.querySelector("img")?.getAttribute("alt") ?? "";
          const textParts = [
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("data-title"),
            element.getAttribute("data-name"),
            imageAlt
          ].map((value) => (value ?? "").replace(/\s+/g, " ").trim()).filter((value) => value.length > 0);
          return textParts[0] ?? "";
        };
        const addCandidate = (
          rawHref: string,
          element: Element,
          elementIndex: number,
          source: "anchor" | "attribute",
          attributeName?: string
        ): boolean => {
          let hrefValue = "";
          try {
            hrefValue = new URL(rawHref, args.baseUrl).href;
          } catch {
            hrefValue = rawHref;
          }
          const text = textFor(element);
          const isVisible = visible(element);
          let valid = false;
          try {
            const href = new URL(hrefValue);
            const hrefWithoutHash = `${href.origin}${href.pathname}${href.search}`;
            valid = isVisible &&
              (href.protocol === "http:" || href.protocol === "https:") &&
              (source === "anchor" || text.length > 0) &&
              (currentWithoutHash.length === 0 || hrefWithoutHash !== currentWithoutHash);
          } catch {
            valid = false;
          }
          candidates.push({
            href: hrefValue,
            text,
            visible: isVisible,
            valid,
            elementIndex,
            source,
            ...(attributeName === undefined ? {} : { attributeName })
          });
          return candidates.length >= args.maxCandidates;
        };
        for (const [elementIndex, element] of elements.slice(0, args.maxContainers).entries()) {
          const anchors: HTMLAnchorElement[] = [];
          if (element instanceof HTMLAnchorElement) {
            anchors.push(element);
          }
          const closest = element.closest("a");
          if (closest instanceof HTMLAnchorElement) {
            anchors.push(closest);
          }
          anchors.push(...Array.from(element.querySelectorAll("a")));
          for (const link of anchors) {
            if (seen.has(link)) {
              continue;
            }
            seen.add(link);
            if (addCandidate(link.href, link, elementIndex, "anchor")) {
              return candidates;
            }
          }
          const attributeElements: Element[] = [];
          if (element.matches(args.attributeSelector)) {
            attributeElements.push(element);
          }
          attributeElements.push(...Array.from(element.querySelectorAll(args.attributeSelector)));
          for (const attributeElement of attributeElements) {
            for (const attributeName of args.destinationAttributeNames) {
              const rawValue = attributeElement.getAttribute(attributeName)?.trim();
              if (rawValue === undefined || rawValue.length === 0) {
                continue;
              }
              const key = `${elementIndex}:${attributeName}:${rawValue}`;
              if (seenAttributeCandidates.has(key)) {
                continue;
              }
              seenAttributeCandidates.add(key);
              if (addCandidate(rawValue, attributeElement, elementIndex, "attribute", attributeName)) {
                return candidates;
              }
            }
          }
        }
        return candidates;
      }, {
        baseUrl,
        maxContainers: 50,
        maxCandidates: Math.max(normalizedMaxLinks * 10, normalizedMaxLinks),
        destinationAttributeNames: DESTINATION_ATTRIBUTE_NAMES,
        attributeSelector: DESTINATION_ATTRIBUTE_SELECTOR
      });
        return frameTargets.map((target) => ({
          ...target,
          frameIndex: frameInfo.index,
          frameUrl: baseUrl,
          frameName: frameInfo.frame.name()
        }));
      } catch {
        return [];
      }
    })), signal);
    return linkTargetsResultFromCandidates({
      currentUrl,
      targets: perFrameTargets.flat(),
      normalizedMaxLinks,
      frameCount: frames.length,
      matchedFrameCount: visibleFrames.length
    });
  }

  async inspectSelector(
    agentId: string,
    contextToken: string,
    pageId: string,
    selector: string,
    options: { maxMatches?: number; maxTextLength?: number; signal?: AbortSignal } = {}
  ): Promise<BrowserSelectorInspection> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const maxMatches = Math.max(1, Math.min(50, options.maxMatches ?? 10));
    const maxTextLength = Math.max(20, Math.min(2_000, options.maxTextLength ?? 300));
    const frameInspections = await withAbort(Promise.all(pageState.page.frames().map(async (frame, frameIndex) => {
      const frameUrl = frame.url();
      const frameName = frame.name();
      try {
        const result = await frame.locator(selector).evaluateAll((nodes, args) => {
        const matches = nodes.slice(0, args.maxMatches).map((node, index) => {
          const element = node as Element;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const visible = rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0;
          const textSnippet = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, args.maxTextLength);
          const match: BrowserSelectorInspectionMatch = {
            index,
            tagName: element.tagName.toLowerCase(),
            visible,
            textSnippet
          };
          const id = element.getAttribute("id");
          if (id !== null && id.length > 0) {
            match.id = id;
          }
          const role = element.getAttribute("role");
          if (role !== null && role.length > 0) {
            match.role = role;
          }
          const ariaLabel = element.getAttribute("aria-label");
          if (ariaLabel !== null && ariaLabel.length > 0) {
            match.ariaLabel = ariaLabel;
          }
          const name = element.getAttribute("name");
          if (name !== null && name.length > 0) {
            match.name = name;
          }
          const href = element instanceof HTMLAnchorElement ? element.href : element.closest("a")?.href;
          if (href !== undefined && href.length > 0) {
            match.href = href;
          }
          return match;
        });
        return {
          matchCount: nodes.length,
          inspectedCount: matches.length,
          visibleCount: matches.filter((match) => match.visible).length,
          matches
        };
      }, { maxMatches, maxTextLength });
        return {
          frameIndex,
          frameUrl,
          frameName,
          ...result
        };
      } catch {
        return {
          frameIndex,
          frameUrl,
          frameName,
          matchCount: 0,
          inspectedCount: 0,
          visibleCount: 0,
          matches: []
        };
      }
    })), options.signal);
    const matches = frameInspections.flatMap((frameInspection) => frameInspection.matches.map((match) => ({
      ...match,
      frameIndex: frameInspection.frameIndex,
      frameUrl: frameInspection.frameUrl,
      ...(frameInspection.frameName.length === 0 ? {} : { frameName: frameInspection.frameName })
    })));
    const inspection = {
      matchCount: frameInspections.reduce((sum, frameInspection) => sum + frameInspection.matchCount, 0),
      inspectedCount: matches.length,
      visibleCount: matches.filter((match) => match.visible).length,
      matches
    };
    const firstTextSnippet = matches.find((match) => match.textSnippet.length > 0)?.textSnippet;
    const firstVisibleTextSnippet = matches.find((match) => match.visible && match.textSnippet.length > 0)?.textSnippet;
    return {
      ok: true,
      url: pageState.page.url(),
      selector,
      matchCount: inspection.matchCount,
      inspectedCount: inspection.inspectedCount,
      visibleCount: inspection.visibleCount,
      ...(firstTextSnippet === undefined ? {} : { firstTextSnippet }),
      ...(firstVisibleTextSnippet === undefined ? {} : { firstVisibleTextSnippet }),
      frameCount: frameInspections.length,
      matchedFrameCount: frameInspections.filter((frameInspection) => frameInspection.matchCount > 0).length,
      visibleFrameCount: frameInspections.filter((frameInspection) => frameInspection.visibleCount > 0).length,
      matches: inspection.matches
    };
  }

  async dismissBenignOverlays(
    agentId: string,
    contextToken: string,
    pageId: string,
    maxActions = 3,
    signal?: AbortSignal
  ): Promise<BrowserOverlayDismissalReport> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    return withAbort(runBenignOverlayDismissal(pageState.page, Math.max(0, Math.min(10, maxActions))), signal);
  }

  async scroll(
    agentId: string,
    contextToken: string,
    pageId: string,
    direction: "down" | "up" | "bottom" | "top",
    pixels: number,
    signal?: AbortSignal
  ): Promise<{ ok: true; url: string; scrollY: number }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const scrollY = await withAbort(pageState.page.evaluate(({ direction: pageDirection, pixels: pagePixels }) => {
      if (pageDirection === "top") {
        window.scrollTo(0, 0);
      } else if (pageDirection === "bottom") {
        window.scrollTo(0, document.documentElement.scrollHeight);
      } else {
        window.scrollBy(0, pageDirection === "up" ? -pagePixels : pagePixels);
      }
      return window.scrollY;
    }, { direction, pixels }), signal);
    return { ok: true, url: pageState.page.url(), scrollY };
  }

  async captureAfterIdle(
    agentId: string,
    contextToken: string,
    pageId: string,
    captureId: string | undefined,
    waitMs: number,
    idleMs: number,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ records: ArtifactRecord[] }> {
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    if (waitMs > 0) {
      await abortableDelay(waitMs, signal);
    }
    await withAbort(pageState.page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined), signal);
    if (idleMs > 0) {
      await abortableDelay(idleMs, signal);
    }
    return this.capturePage(agentId, lease.contextToken, pageId, captureId, signal);
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
      abortSignal?: AbortSignal | undefined;
    }
  ): Promise<FrameSampleRunResult> {
    throwIfAborted(input.abortSignal);
    const lease = this.leaseManager.assertActive(contextToken, agentId);
    const pageState = this.getPageState(lease.contextToken, pageId);
    const page = pageState.page;
    const sourceUrl = page.url() || pageState.url;
    const baseCaptureId = sanitizeFileBase(input.captureId ?? `frame-sample-${new URL(sourceUrl).hostname}-${randomUUID()}`);
    const media = await withAbort(readMediaElementSnapshot(page, input.selector), input.abortSignal);
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
    const summaryRecords = await withAbort(this.artifactWriter.writeCaptureBundle({
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
    }), input.abortSignal);

    const frames: FrameSample[] = [];
    const records: ArtifactRecord[] = [...summaryRecords];
    for (const [index, timestampSec] of plan.timestampsSec.entries()) {
      throwIfAborted(input.abortSignal);
      const ordinal = index + 1;
      const currentCaptureId = frameCaptureId(baseCaptureId, ordinal, timestampSec);
      const seek = await withAbort(seekMediaElement(page, input.selector, timestampSec, input.seekTimeoutMs), input.abortSignal);
      if (input.settleMs > 0) {
        await abortableDelay(input.settleMs, input.abortSignal);
      }
      const activeCues = await withAbort(readActiveCues(page, input.selector).catch(() => []), input.abortSignal);
      const visualFingerprint = await withAbort(readVisualFingerprint(page, input.selector), input.abortSignal);
      const frameStatus = seek.ok ? "ok" : "partial";
      try {
        const screenshot = await withAbort(page.locator(input.selector).first().screenshot({ timeout: 10_000 }), input.abortSignal);
        const frameRecords = await withAbort(this.artifactWriter.writeCaptureBundle({
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
              activeCues,
              visualFingerprint
            }
          },
          note: seek.ok ? `frame sample at ${timestampSec}s` : `partial frame sample at ${timestampSec}s: ${seek.reason ?? "seek_failed"}`
        }), input.abortSignal);
        records.push(...frameRecords);
        frames.push({
          ordinal,
          timestampSec,
          captureId: currentCaptureId,
          status: frameStatus,
          seek,
          activeCues,
          visualFingerprint,
          records: frameRecords
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
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
              activeCues,
              visualFingerprint
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
          visualFingerprint,
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
      warnings,
      denseSamplingEvents: []
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
      releaseProfileLock(state.profileLock);
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
    let profileLock: ProfileLockHandle | undefined;
    if (profileLockKey !== undefined) {
      const activeLease = this.activeProfileLeases.get(profileLockKey);
      if (activeLease !== undefined && activeLease !== lease.contextToken) {
        throw new FarmError("profile_in_use", `Profile or storage state is already leased by ${activeLease}: ${profileLockKey}`);
      }
      // Cross-process guard: the in-memory map above only sees this process, but
      // a separate farm process (e.g. another agent's `serve`) can lease the
      // same profile and clobber its shared storage-state file. The on-disk lock
      // throws profile_in_use across processes.
      profileLock = acquireProfileLock(profileLockKey, lease.contextToken);
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
          ...this.launchOptions()
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
      if (profileLock !== undefined) {
        state.profileLock = profileLock;
      }
      this.contexts.set(lease.contextToken, state);
      return state;
    } catch (error) {
      if (profileLockKey !== undefined && this.activeProfileLeases.get(profileLockKey) === lease.contextToken) {
        this.activeProfileLeases.delete(profileLockKey);
      }
      releaseProfileLock(profileLock);
      throw error;
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }
    if (!this.browserLaunch) {
      this.browserLaunch = chromium.launch(this.launchOptions()).then((browser) => {
        this.browser = browser;
        return browser;
      });
    }
    return this.browserLaunch;
  }

  private launchOptions(): { headless: boolean; channel?: string } {
    return {
      headless: this.launchHeadless,
      ...(this.browserChannel === undefined ? {} : { channel: this.browserChannel })
    };
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

function normalizeBrowserChannel(channel: string | undefined): string | undefined {
  const trimmed = channel?.trim();
  return trimmed === undefined || trimmed.length === 0 || trimmed === "chromium" ? undefined : trimmed;
}

function isUsableFollowUpUrl(href: string, current: string): boolean {
  let target: URL;
  let currentUrl: URL;
  try {
    target = new URL(href);
    currentUrl = new URL(current);
  } catch {
    return false;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return false;
  }
  return `${target.origin}${target.pathname}${target.search}` !== `${currentUrl.origin}${currentUrl.pathname}${currentUrl.search}`;
}

interface BrowserVisibleTextFrameMetadata {
  frameIndex: number;
  frameUrl: string;
  frameName?: string;
  textLength: number;
  truncated: boolean;
  textSnippet?: string;
  error?: string;
}

interface BrowserVisibleTextResult {
  text: string;
  metadata: {
    frameCount: number;
    textFrameCount: number;
    frames: BrowserVisibleTextFrameMetadata[];
  };
}

async function collectVisibleFrameText(page: Page, currentUrl: string): Promise<BrowserVisibleTextResult> {
  const maxPerFrame = 50_000;
  const maxTotal = 200_000;
  const frames = page.frames();
  const frameResults = await Promise.all(frames.map(async (frame, frameIndex): Promise<BrowserVisibleTextFrameMetadata & { text: string }> => {
    const frameUrl = frame.url() || currentUrl;
    const frameName = frame.name();
    try {
      const rawText = await frame.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
      const text = rawText.trim();
      const textSnippet = text.replace(/\s+/g, " ").slice(0, 300);
      return {
        frameIndex,
        frameUrl,
        ...(frameName.length === 0 ? {} : { frameName }),
        textLength: text.length,
        truncated: text.length > maxPerFrame,
        ...(textSnippet.length === 0 ? {} : { textSnippet }),
        text: text.length > maxPerFrame ? text.slice(0, maxPerFrame) : text
      };
    } catch (error) {
      return {
        frameIndex,
        frameUrl,
        ...(frameName.length === 0 ? {} : { frameName }),
        textLength: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
        text: ""
      };
    }
  }));
  const parts: string[] = [];
  const seen = new Set<string>();
  let remaining = maxTotal;
  for (const frame of frameResults) {
    if (remaining <= 0 || frame.text.length === 0) {
      continue;
    }
    const normalized = frame.text.replace(/\s+/g, " ").trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    const selected = frame.text.length > remaining ? frame.text.slice(0, remaining) : frame.text;
    parts.push(selected);
    remaining -= selected.length;
  }
  return {
    text: parts.join("\n\n"),
    metadata: {
      frameCount: frameResults.length,
      textFrameCount: frameResults.filter((frame) => frame.textLength > 0).length,
      frames: frameResults.map(({ text: _text, ...metadata }) => metadata)
    }
  };
}

async function collectVisibleLinks(page: Page, currentUrl: string, maxLinks = 25): Promise<BrowserLinkTarget[]> {
  const normalizedMaxLinks = Math.max(1, Math.min(100, maxLinks));
  const frames = page.frames();
  const perFrameCandidates = await Promise.all(frames.map(async (frame, frameIndex) => {
    const baseUrl = frame.url() || currentUrl;
    const frameName = frame.name();
    try {
      const candidates = await frame.evaluate((args) => {
    const selector = `a, ${args.attributeSelector}`;
    const elements = Array.from(document.querySelectorAll(selector)).slice(0, 200);
    const candidateRows: Array<{ href: string; text: string; visible: boolean; elementIndex: number; source: "anchor" | "attribute"; attributeName?: string }> = [];
    const textFor = (element: Element): string => {
      const imageAlt = element.querySelector("img")?.getAttribute("alt") ?? "";
      const textParts = [
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-title"),
        element.getAttribute("data-name"),
        imageAlt
      ].map((value) => (value ?? "").replace(/\s+/g, " ").trim()).filter((value) => value.length > 0);
      return textParts[0] ?? "";
    };
    const visible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0;
    };
    for (const [elementIndex, element] of elements.entries()) {
      if (element instanceof HTMLAnchorElement) {
        candidateRows.push({
          href: element.href,
          text: textFor(element),
          visible: visible(element),
          elementIndex,
          source: "anchor"
        });
        continue;
      }
      for (const attributeName of args.destinationAttributeNames) {
        const rawValue = element.getAttribute(attributeName)?.trim();
        if (rawValue === undefined || rawValue.length === 0) {
          continue;
        }
        let hrefValue = rawValue;
        try {
          hrefValue = new URL(rawValue, args.currentUrl).href;
        } catch {
          hrefValue = rawValue;
        }
        candidateRows.push({
          href: hrefValue,
          text: textFor(element),
          visible: visible(element),
          elementIndex,
          source: "attribute",
          attributeName
        });
        break;
      }
    }
    return candidateRows.slice(0, args.maxCandidates);
  }, {
        currentUrl: baseUrl,
        maxCandidates: Math.max(normalizedMaxLinks * 8, normalizedMaxLinks),
        destinationAttributeNames: DESTINATION_ATTRIBUTE_NAMES,
        attributeSelector: DESTINATION_ATTRIBUTE_SELECTOR
      });
      return candidates.map((candidate) => {
        let valid = false;
        try {
          const parsed = new URL(candidate.href);
          valid = candidate.visible &&
            (parsed.protocol === "http:" || parsed.protocol === "https:") &&
            (candidate.source === "anchor" || candidate.text.length > 0);
        } catch {
          valid = false;
        }
        return {
          href: candidate.href,
          text: candidate.text,
          visible: candidate.visible,
          valid,
          elementIndex: candidate.elementIndex,
          source: candidate.source,
          ...(candidate.attributeName === undefined ? {} : { attributeName: candidate.attributeName }),
          frameIndex,
          frameUrl: baseUrl,
          ...(frameName.length === 0 ? {} : { frameName })
        };
      });
    } catch {
      return [];
    }
  }));
  return linkTargetsResultFromCandidates({
    currentUrl,
    targets: perFrameCandidates.flat(),
    normalizedMaxLinks,
    frameCount: frames.length,
    matchedFrameCount: perFrameCandidates.filter((candidates) => candidates.length > 0).length
  }).links;
}

function normalizedHrefWithoutHash(href: string): string | undefined {
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function isSafeWindowPropertyName(propertyName: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]{0,120}$/.test(propertyName);
}

function linkTargetsResultFromCandidates(input: {
  currentUrl: string;
  targets: Array<{
    href: string;
    text: string;
    visible: boolean;
    valid: boolean;
    elementIndex: number;
    source: "anchor" | "attribute";
    attributeName?: string;
    frameIndex?: number;
    frameUrl?: string;
    frameName?: string;
  }>;
  normalizedMaxLinks: number;
  frameCount?: number;
  matchedFrameCount?: number;
}): BrowserLinkTargetsResult {
  const usableTargets = input.targets.filter((target) => target.valid && isUsableFollowUpUrl(target.href, input.currentUrl));
  const seenNormalizedUrls = new Set<string>();
  const uniqueTargets: typeof usableTargets = [];
  const duplicateTargets: typeof usableTargets = [];
  for (const target of usableTargets) {
    const normalized = normalizedHrefWithoutHash(target.href);
    if (normalized !== undefined && seenNormalizedUrls.has(normalized)) {
      duplicateTargets.push(target);
      continue;
    }
    if (normalized !== undefined) {
      seenNormalizedUrls.add(normalized);
    }
    uniqueTargets.push(target);
  }
  const selectedTargets = uniqueTargets.length >= input.normalizedMaxLinks
    ? uniqueTargets.slice(0, input.normalizedMaxLinks)
    : [...uniqueTargets, ...duplicateTargets].slice(0, input.normalizedMaxLinks);
  const selectedDuplicateCount = selectedTargets.filter((target) => duplicateTargets.includes(target)).length;
  const links = selectedTargets.map((target, index) => ({
    index,
    url: target.href,
    text: target.text,
    elementIndex: target.elementIndex,
    source: target.source,
    ...(target.attributeName === undefined ? {} : { attributeName: target.attributeName }),
    ...(target.frameIndex === undefined ? {} : { frameIndex: target.frameIndex }),
    ...(target.frameUrl === undefined ? {} : { frameUrl: target.frameUrl }),
    ...(target.frameName === undefined || target.frameName.length === 0 ? {} : { frameName: target.frameName })
  }));
  return {
    ok: true,
    url: input.currentUrl,
    links,
    rawCandidateCount: input.targets.length,
    usableCandidateCount: usableTargets.length,
    uniqueCandidateCount: uniqueTargets.length,
    duplicateCandidateCount: duplicateTargets.length,
    omittedDuplicateCount: Math.max(0, duplicateTargets.length - selectedDuplicateCount),
    anchorCandidateCount: input.targets.filter((target) => target.source === "anchor").length,
    attributeCandidateCount: input.targets.filter((target) => target.source === "attribute").length,
    ...(input.frameCount === undefined ? {} : { frameCount: input.frameCount }),
    ...(input.matchedFrameCount === undefined ? {} : { matchedFrameCount: input.matchedFrameCount })
  };
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

async function runBenignOverlayDismissal(page: Page, maxActions: number): Promise<BrowserOverlayDismissalReport> {
  const report = await page.evaluate(async ({ maxActions: actionLimit }) => {
    const actions: BrowserOverlayDismissalAction[] = [];
    const warnings: string[] = [];
    const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

    for (let attempt = 0; attempt < actionLimit; attempt += 1) {
      const candidate = findDismissibleCandidate();
      if (candidate === undefined) {
        break;
      }
      candidate.element.setAttribute("data-browser-farm-dismiss-attempted", "true");
      try {
        candidate.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        candidate.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        candidate.element.click();
        actions.push({
          kind: candidate.kind,
          label: candidate.label,
          status: "dismissed"
        });
        await sleep(150);
      } catch (error) {
        actions.push({
          kind: candidate.kind,
          label: candidate.label,
          status: "error",
          reason: error instanceof Error ? error.message : String(error)
        });
        warnings.push(`overlay_dismissal_error:${candidate.label}`);
        break;
      }
    }

    const skipped = collectSkippedCandidates();
    actions.push(...skipped);
    const dismissedCount = actions.filter((action) => action.status === "dismissed").length;
    const skippedCount = actions.filter((action) => action.status === "skipped").length;
    const hasError = actions.some((action) => action.status === "error");

    return {
      status: hasError ? "partial" : dismissedCount > 0 ? "dismissed" : "clear",
      dismissedCount,
      skippedCount,
      actions: actions.slice(0, 20),
      warnings
    };

    function findDismissibleCandidate(): { element: HTMLElement; label: string; kind: BrowserOverlayDismissalKind } | undefined {
      for (const element of interactiveElements()) {
        if (element.hasAttribute("data-browser-farm-dismiss-attempted") || !isVisible(element)) {
          continue;
        }
        const label = normalizedLabel(element);
        const context = normalizedOverlayContext(element);
        if (!isOverlayRelated(element, context) || isBlockedAction(label, context) || !isAllowedDismissal(label)) {
          continue;
        }
        return { element, label, kind: kindFor(label, context) };
      }
      return undefined;
    }

    function collectSkippedCandidates(): BrowserOverlayDismissalAction[] {
      const skipped: BrowserOverlayDismissalAction[] = [];
      for (const element of interactiveElements()) {
        if (!isVisible(element)) {
          continue;
        }
        const label = normalizedLabel(element);
        const context = normalizedOverlayContext(element);
        if (!isOverlayRelated(element, context) || !isBlockedAction(label, context)) {
          continue;
        }
        skipped.push({
          kind: kindFor(label, context),
          label,
          status: "skipped",
          reason: "access-control-or-state-changing-action"
        });
        if (skipped.length >= 10) {
          break;
        }
      }
      return skipped;
    }

    function interactiveElements(): HTMLElement[] {
      return Array.from(document.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit'],[aria-label]"))
        .filter((element): element is HTMLElement => element instanceof HTMLElement);
    }

    function normalizedLabel(element: HTMLElement): string {
      return normalize([
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("value"),
        element.getAttribute("id"),
        element.getAttribute("class")
      ].filter((value): value is string => value !== null && value.trim().length > 0).join(" "));
    }

    function normalizedOverlayContext(element: HTMLElement): string {
      const values: string[] = [];
      let current: Element | null = element;
      for (let depth = 0; current !== null && depth < 5; depth += 1) {
        if (current instanceof HTMLElement) {
          values.push(
            current.innerText.slice(0, 500),
            current.getAttribute("aria-label") ?? "",
            current.getAttribute("role") ?? "",
            current.id,
            current.className
          );
        }
        current = current.parentElement;
      }
      return normalize(values.join(" "));
    }

    function isVisible(element: HTMLElement): boolean {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
    }

    function isOverlayRelated(element: HTMLElement, context: string): boolean {
      if (containsAny(context, ["cookie", "consent", "privacy", "gdpr", "newsletter", "subscribe", "popup", "modal", "dialog", "overlay", "banner"])) {
        return true;
      }

      let current: Element | null = element;
      for (let depth = 0; current !== null && depth < 5; depth += 1) {
        if (current instanceof HTMLElement) {
          const style = window.getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          const zIndex = Number.parseInt(style.zIndex || "0", 10);
          const role = current.getAttribute("role");
          const ariaModal = current.getAttribute("aria-modal");
          if (current instanceof HTMLDialogElement || role === "dialog" || role === "alertdialog" || ariaModal === "true") {
            return true;
          }
          if (["fixed", "sticky"].includes(style.position) && (Number.isFinite(zIndex) ? zIndex >= 10 : true) && rect.width >= 120 && rect.height >= 40) {
            return true;
          }
        }
        current = current.parentElement;
      }
      return false;
    }

    function isAllowedDismissal(label: string): boolean {
      if (["x", "×", "✕", "close"].includes(label)) {
        return true;
      }
      return containsAny(label, [
        "close",
        "dismiss",
        "not now",
        "no thanks",
        "maybe later",
        "skip",
        "reject all",
        "reject optional",
        "decline",
        "only necessary",
        "necessary only",
        "continue without accepting",
        "got it"
      ]);
    }

    function isBlockedAction(label: string, context: string): boolean {
      const actionText = `${label} ${context}`;
      if (containsAny(actionText, ["captcha", "verify you are human", "challenge required", "age-restricted", "confirm your age", "verify your age", "18+", "payment", "checkout", "pay now"])) {
        return true;
      }
      return containsAny(label, [
        "log in",
        "login",
        "sign in",
        "sign up",
        "create account",
        "continue with facebook",
        "continue with google",
        "open app",
        "open the app",
        "download the app",
        "get the app",
        "continue in the app",
        "accept all",
        "allow all",
        "i agree",
        "agree and continue"
      ]);
    }

    function kindFor(label: string, context: string): BrowserOverlayDismissalKind {
      if (containsAny(context, ["cookie", "consent", "privacy", "gdpr"])) {
        return "cookie_consent";
      }
      if (containsAny(context, ["open app", "download the app", "get the app", "continue in the app"])) {
        return "app_banner";
      }
      if (containsAny(context, ["newsletter", "subscribe", "email signup"])) {
        return "newsletter_prompt";
      }
      if (["x", "×", "✕", "close"].includes(label) || containsAny(context, ["modal", "dialog", "popup"])) {
        return "modal_close";
      }
      return "generic_overlay";
    }

    function containsAny(value: string, tokens: string[]): boolean {
      return tokens.some((token) => value.includes(token));
    }

    function normalize(value: string): string {
      return value.toLowerCase().replace(/\s+/g, " ").trim();
    }
  }, { maxActions });

  return report as BrowserOverlayDismissalReport;
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

async function readVisualFingerprint(page: Page, selector: string): Promise<FrameVisualFingerprint> {
  return page.locator(selector).first().evaluate((node) => {
    const sampleSide = 8;
    try {
      if (!(node instanceof HTMLVideoElement)) {
        return {
          status: "unavailable",
          sampleSize: sampleSide * sampleSide,
          reason: "element_is_not_video"
        };
      }
      const canvas = document.createElement("canvas");
      canvas.width = sampleSide;
      canvas.height = sampleSide;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        return {
          status: "unavailable",
          sampleSize: sampleSide * sampleSide,
          reason: "canvas_2d_context_unavailable"
        };
      }
      context.drawImage(node, 0, 0, sampleSide, sampleSide);
      const data = context.getImageData(0, 0, sampleSide, sampleSide).data;
      const lumas: number[] = [];
      for (let index = 0; index < data.length; index += 4) {
        lumas.push((data[index] ?? 0) * 0.299 + (data[index + 1] ?? 0) * 0.587 + (data[index + 2] ?? 0) * 0.114);
      }
      const average = lumas.reduce((sum, value) => sum + value, 0) / Math.max(1, lumas.length);
      const hash = lumas.map((value) => value >= 128 ? "1" : "0").join("");
      return {
        status: "ok",
        sampleSize: lumas.length,
        hash,
        averageLuma: Math.round(average * 1000) / 1000
      };
    } catch (error) {
      return {
        status: "unavailable",
        sampleSize: sampleSide * sampleSide,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
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

async function drainMediaCaptures(state: PageState, signal?: AbortSignal): Promise<void> {
  const pending = [...state.pendingMediaCaptures];
  if (pending.length === 0) {
    return;
  }
  await Promise.race([
    Promise.allSettled(pending),
    abortableDelay(MEDIA_DRAIN_TIMEOUT_MS, signal)
  ]);
}

function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolvePromise, reject) => {
    let timeout: NodeJS.Timeout | undefined;
    let removeAbortListener: (() => void) | undefined;
    const finish = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      removeAbortListener?.();
    };
    timeout = setTimeout(() => {
      finish();
      resolvePromise();
    }, ms);
    if (signal !== undefined) {
      const listener = (): void => {
        finish();
        try {
          throwIfAborted(signal);
        } catch (error) {
          reject(error);
        }
      };
      signal.addEventListener("abort", listener, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", listener);
    }
  });
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

async function framesWithVisibleSelector(
  frames: Frame[],
  selector: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Array<{ frame: Frame; index: number }>> {
  const results = await withAbort(Promise.all(frames.map(async (frame, index) => {
    try {
      await frame.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
      return { frame, index };
    } catch {
      return undefined;
    }
  })), signal);
  return results.filter((result): result is { frame: Frame; index: number } => result !== undefined);
}

function actionTimeoutMs(options: BrowserActionOptions): number {
  const timeout = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new RangeError("timeoutMs must be a positive integer");
  }
  return timeout;
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
