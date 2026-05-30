import { randomUUID } from "node:crypto";
import type { FingerprintSchema, ProxyConfigSchema } from "./schemas.js";
import { FarmError } from "./farm-error.js";
import type { AcquireContextInput } from "./schemas.js";
import type { z } from "zod";

export type LeaseStatus = "active" | "released" | "expired" | "crashed";
export type Capability = "read-only" | "read-write";
export type StoragePolicy = "ephemeral" | "storage-state" | "persistent-profile";
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export interface Lease {
  contextToken: string;
  agentId: string;
  runId: string;
  artifactRunDir: string;
  createdAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  ttlMs: number;
  capability: Capability;
  allowedDomains: string[];
  maxPages: number;
  storagePolicy: StoragePolicy;
  profileName?: string;
  storageStatePath?: string;
  userDataDir?: string;
  proxy?: ProxyConfig;
  fingerprint?: Fingerprint;
  status: LeaseStatus;
  pages: string[];
}

export interface LeaseManagerOptions {
  defaultTtlMs?: number;
  defaultMaxPages?: number;
  now?: () => Date;
  /**
   * Global cap on concurrently-active leases. When the cap is reached, acquire() rejects
   * with a typed `capacity_exhausted` error instead of overloading the host — backpressure.
   * Capacity auto-recovers as leases are released or expire. Undefined = unlimited.
   */
  maxContexts?: number;
}

/**
 * Read LeaseManager options from the environment. `FARM_MAX_CONTEXTS` (a positive integer)
 * sets the global concurrent-context cap so a deployed `serve`/`serve-http` applies real
 * backpressure; unset/invalid leaves the farm unlimited (unchanged default behavior).
 */
export function leaseManagerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LeaseManagerOptions {
  const raw = env.FARM_MAX_CONTEXTS;
  if (raw === undefined || raw.trim().length === 0) {
    return {};
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {};
  }
  return { maxContexts: parsed };
}

export class LeaseManager {
  private readonly leases = new Map<string, Lease>();
  private readonly now: () => Date;
  private readonly defaultTtlMs: number;
  private readonly defaultMaxPages: number;
  private readonly maxContexts: number | undefined;

  constructor(options: LeaseManagerOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;
    this.defaultMaxPages = options.defaultMaxPages ?? 3;
    this.maxContexts = options.maxContexts;
  }

  /** Count leases that are active and not yet past their expiry (i.e. holding capacity). */
  activeContextCount(): number {
    const nowMs = this.now().getTime();
    let count = 0;
    for (const lease of this.leases.values()) {
      if (lease.status === "active" && Date.parse(lease.expiresAt) > nowMs) {
        count += 1;
      }
    }
    return count;
  }

  acquire(input: AcquireContextInput): Lease {
    const now = this.now();
    if (this.maxContexts !== undefined) {
      const active = this.activeContextCount();
      if (active >= this.maxContexts) {
        throw new FarmError("capacity_exhausted", `Lease capacity exhausted: ${active}/${this.maxContexts} active contexts — release or wait for expiry`);
      }
    }
    const ttlMs = input.ttlMs ?? this.defaultTtlMs;
    const token = `ctx_${randomUUID()}`;
    const lease: Lease = {
      contextToken: token,
      agentId: input.agentId,
      runId: input.runId,
      artifactRunDir: input.artifactRunDir,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      lastHeartbeatAt: now.toISOString(),
      ttlMs,
      capability: input.capability ?? "read-only",
      allowedDomains: normalizeDomains(input.allowedDomains ?? []),
      maxPages: input.maxPages ?? this.defaultMaxPages,
      storagePolicy: input.storagePolicy ?? "ephemeral",
      status: "active",
      pages: []
    };
    if (input.profileName !== undefined) {
      lease.profileName = input.profileName;
    }
    if (input.storageStatePath !== undefined) {
      lease.storageStatePath = input.storageStatePath;
    }
    if (input.userDataDir !== undefined) {
      lease.userDataDir = input.userDataDir;
    }
    if (input.proxy !== undefined) {
      lease.proxy = input.proxy;
    }
    if (input.fingerprint !== undefined) {
      lease.fingerprint = input.fingerprint;
    }

    this.leases.set(token, lease);
    return cloneLease(lease);
  }

  heartbeat(contextToken: string, agentId: string): Lease {
    const lease = this.assertActive(contextToken, agentId);
    const now = this.now();
    lease.lastHeartbeatAt = now.toISOString();
    lease.expiresAt = new Date(now.getTime() + lease.ttlMs).toISOString();
    return cloneLease(lease);
  }

  release(contextToken: string, agentId: string): Lease {
    const lease = this.assertOwned(contextToken, agentId);
    if (lease.status === "active") {
      lease.status = "released";
      lease.pages = [];
    }
    return cloneLease(lease);
  }

  markCrashed(contextToken: string): Lease {
    const lease = this.getExisting(contextToken);
    lease.status = "crashed";
    lease.pages = [];
    return cloneLease(lease);
  }

  assertActive(contextToken: string, agentId?: string): Lease {
    const lease = agentId ? this.assertOwned(contextToken, agentId) : this.getExisting(contextToken);
    if (lease.status !== "active") {
      throw new FarmError("lease_not_active", `Lease is ${lease.status}: ${contextToken}`);
    }
    if (Date.parse(lease.expiresAt) <= this.now().getTime()) {
      lease.status = "expired";
      lease.pages = [];
      throw new FarmError("lease_expired", `Lease expired: ${contextToken}`);
    }
    return lease;
  }

  assertCanOpen(contextToken: string, agentId: string, url: string): Lease {
    const lease = this.assertActive(contextToken, agentId);
    if (lease.pages.length >= lease.maxPages) {
      throw new FarmError("page_limit_exceeded", `Lease page limit exceeded: ${contextToken}`);
    }
    assertDomainAllowed(lease.allowedDomains, url);
    return lease;
  }

  assertCanMutate(contextToken: string, agentId: string): Lease {
    const lease = this.assertActive(contextToken, agentId);
    if (lease.capability !== "read-write") {
      throw new FarmError("capability_denied", `Lease does not allow write actions: ${contextToken}`);
    }
    return lease;
  }

  registerPage(contextToken: string, agentId: string, pageId: string, url: string): Lease {
    const lease = this.assertCanOpen(contextToken, agentId, url);
    if (!lease.pages.includes(pageId)) {
      lease.pages.push(pageId);
    }
    return cloneLease(lease);
  }

  closePage(contextToken: string, agentId: string, pageId: string): Lease {
    const lease = this.assertActive(contextToken, agentId);
    lease.pages = lease.pages.filter((item) => item !== pageId);
    return cloneLease(lease);
  }

  get(contextToken: string, agentId?: string): Lease {
    return cloneLease(this.assertActive(contextToken, agentId));
  }

  list(): Lease[] {
    for (const lease of this.leases.values()) {
      if (lease.status === "active" && Date.parse(lease.expiresAt) <= this.now().getTime()) {
        lease.status = "expired";
        lease.pages = [];
      }
    }
    return [...this.leases.values()].map(cloneLease);
  }

  reapExpired(): Lease[] {
    const expired: Lease[] = [];
    for (const lease of this.leases.values()) {
      if (lease.status === "active" && Date.parse(lease.expiresAt) <= this.now().getTime()) {
        lease.status = "expired";
        lease.pages = [];
        expired.push(cloneLease(lease));
      }
    }
    return expired;
  }

  private assertOwned(contextToken: string, agentId: string): Lease {
    const lease = this.getExisting(contextToken);
    if (lease.agentId !== agentId) {
      throw new FarmError("lease_owner_mismatch", `Lease ${contextToken} is not owned by ${agentId}`);
    }
    return lease;
  }

  private getExisting(contextToken: string): Lease {
    const lease = this.leases.get(contextToken);
    if (!lease) {
      throw new FarmError("lease_not_found", `Lease not found: ${contextToken}`);
    }
    return lease;
  }
}

function normalizeDomains(domains: string[]): string[] {
  return domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
}

function assertDomainAllowed(allowedDomains: string[], url: string): void {
  if (allowedDomains.length === 0) {
    return;
  }

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new FarmError("invalid_url", `Invalid URL: ${url}`);
  }

  const allowed = allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) {
    throw new FarmError("domain_not_allowed", `Domain is not allowed for this lease: ${host}`);
  }
}

function cloneLease(lease: Lease): Lease {
  const cloned: Lease = {
    ...lease,
    pages: [...lease.pages],
    allowedDomains: [...lease.allowedDomains]
  };
  if (lease.proxy !== undefined) {
    cloned.proxy = { ...lease.proxy };
  }
  if (lease.fingerprint !== undefined) {
    cloned.fingerprint = { ...lease.fingerprint };
    if (lease.fingerprint.viewport !== undefined) {
      cloned.fingerprint.viewport = { ...lease.fingerprint.viewport };
    }
  }
  return cloned;
}

/**
 * Redact secrets and absolute profile paths from a lease before it is returned
 * in a tool result. Internal code keeps the real lease (the proxy password is
 * used to authenticate the upstream proxy); only the OUTBOUND copy is scrubbed.
 */
export function redactLease(lease: Lease): Lease {
  const redacted = cloneLease(lease);
  if (redacted.proxy !== undefined) {
    redacted.proxy = redactProxy(redacted.proxy);
  }
  if (redacted.storageStatePath !== undefined) {
    redacted.storageStatePath = "[redacted path]";
  }
  if (redacted.userDataDir !== undefined) {
    redacted.userDataDir = "[redacted path]";
  }
  return redacted;
}

export function redactProxy(proxy: ProxyConfig): ProxyConfig {
  const redacted: ProxyConfig = { server: redactProxyServer(proxy.server) };
  if (proxy.username !== undefined) {
    redacted.username = "***";
  }
  if (proxy.password !== undefined) {
    redacted.password = "***";
  }
  return redacted;
}

function redactProxyServer(server: string): string {
  try {
    const url = new URL(server);
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
      return url.toString();
    }
    return server;
  } catch {
    return server;
  }
}
