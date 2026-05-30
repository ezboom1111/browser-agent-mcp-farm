#!/usr/bin/env node
// Browser presence guard.
//
// ~26% of the test suite is browser-backed and uses a per-test pattern that
// silently `return`s (reporting a false-green PASS with zero assertions) when
// Playwright Chromium is not installed. For an evidence-first tool, a green gate
// must mean the browser tests actually ran. This guard fails LOUD if Chromium
// cannot launch, so `npm run verify` green ⇒ Chromium present ⇒ those tests ran.
//
// It is wired into `npm run verify` only (before the test step). Plain
// `npm test` still works without Chromium for quick logic-test iteration.

import { chromium } from "playwright";

try {
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  console.log("Browser guard OK: Playwright Chromium launches.");
} catch (error) {
  console.error("Browser guard FAILED: Playwright Chromium could not launch.");
  console.error(
    "Browser-backed tests (~26% of the suite) would silently skip and report a",
  );
  console.error("false-green PASS. Fix: npx playwright install --with-deps chromium");
  console.error(`\nUnderlying error: ${error?.message ?? error}`);
  process.exit(1);
}
