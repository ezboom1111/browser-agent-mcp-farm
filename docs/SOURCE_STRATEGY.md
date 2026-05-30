# Source Strategy Plan

This document describes the generic plan for applying Browser-Agent MCP Farm to
portals, maps, blogs, search pages, and travel booking platforms.

For the current product roadmap and implementation breakdown, read these files
next:

- `docs/PRODUCT_DEVELOPMENT_PLAN.md`: top-level product direction and roadmap
- `docs/INFORMATION_SOURCE_TAXONOMY.md`: implemented category/locale/top-slot
  coverage registry
- `docs/PORTAL_NAVIGATION_ARCHITECTURE.md`: engineering review and architecture
- `docs/PORTAL_NAVIGATION_IMPLEMENTATION_GUIDE.md`: build-level task guide

## Core Principle

The farm should not pretend that every site has the same evidence model. Each
run first records:

- the source family, such as search, map, blog, travel booking, video/social, or
  generic web
- the detected platform, such as Naver Map, Naver Blog, Google Maps, Agoda, or
  Trip.com
- the browser-visible evidence plan
- the portal-native navigation actions from `SourceNavigationPlan`
- what the agent must specify before the run
- what must remain unsupported, such as payment, booking, raw media download, or
  access-control bypass

The source strategy artifact is planning metadata. Final claims still need
registered evidence artifacts such as screenshots, visible text, OCR output,
transcript cues, official API metadata, or sampled frames.

The layer before source strategy is now a source coverage registry. It answers
"which information category, locale, top platform slot, and support tier does
this run serve?" The registry is documented in
`docs/INFORMATION_SOURCE_TAXONOMY.md` and is recorded as a `source_registry`
artifact before broad real-site recipe catalogs are enabled.

The next product layer is a `source_navigation_plan` artifact. Source strategy
answers "what kind of source is this?" Navigation plan answers "which tabs,
filters, sort menus, map viewports, detail pages, media panels, OCR targets, and
follow-up runs matter for this source?" That plan artifact now exists; the
safe executor now supports explicit actions plus bounded one-depth destination
follow-up runs. The remaining work is real-site recipe calibration and richer
fixture coverage, not default crawling.

## Naver

Naver Map and place pages should start with browser-visible evidence:

- map/listing viewport screenshot
- selected place panel screenshot
- visible place name, address, hours, rating/review snippets, filters, and
  search query
- OCR over screenshots when map labels, badges, or pins are image-rendered

Naver Blog should start with article evidence:

- title, author/date if visible, permalink, body text, screenshots
- visible comments and embedded media only when claims depend on them

Official Naver API clients should be added later only behind explicit
credentials and documented scopes. They should not replace the browser-visible
artifact trail.

## Google

Google Search evidence is evidence of the result page, not proof of destination
content. Search runs should record:

- query, locale, visible ranking, snippets, filters, ad/organic distinction when
  visible, and timestamp
- separate follow-up evidence runs for destination pages when final claims
  depend on the destination

Google Maps evidence should record:

- map viewport, selected place/listing panel, visible rating/review/address/hours
- locale, zoom/viewport context, route/search context, and timestamp

Future Google Places/Maps API clients should be credential-gated and kept
separate from browser-visible capture.

## Travel Booking

Agoda, Trip.com, Booking.com, Expedia, and similar platforms are volatile
commerce surfaces. Evidence must preserve the exact query state:

- check-in/check-out dates
- guests, rooms, filters, currency, taxes/fees visibility
- room/rate name, cancellation terms, visible availability, and timestamp
- screenshots plus OCR when prices or terms are rendered as images

The farm must not perform booking, payment, reservation, or account-changing
actions. Profile/headed mode can be used when login changes visibility, but
login state must be treated as part of the evidence context.

## General Pattern

For each new platform family:

1. Detect source family and platform from URL.
2. Record source strategy as an artifact.
3. Record source navigation plan as an artifact.
4. Record source navigation execution plan as an artifact.
5. Execute only explicit safe navigation recipes when `sourceNavigation.enabled`
   and `sourceNavigation.actions` are supplied; otherwise keep the plan as
   evidence context.
6. For explicit `follow_up` recipes, resolve the destination URL without
   clicking through in the parent page and run a bounded child evidence capture
   under `runDir/followups`.
7. Capture browser-visible page state.
8. Dismiss only ordinary overlays when configured.
9. Classify obstructions instead of pretending access succeeded.
10. Add structured derivatives only when deterministic and lawful.
11. Require final claims to cite registered artifacts.

This is intentionally a local evidence framework, not an autonomous crawler and
not a bypass system.
