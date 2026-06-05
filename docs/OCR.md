# OCR Setup

OCR is optional. The package declares `tesseract.js` as an **optional
dependency**, so a normal `npm install` / `npx` of the farm auto-installs the
OCR engine on every machine, and the overall install does **not** fail if that
single optional package cannot be fetched or built (e.g. offline or
`--omit=optional`). The heavy language traineddata is still downloaded lazily on
the first recognize call, so non-OCR users pay almost nothing.

## Install

The engine normally comes along automatically. Only run this if a lean/offline
install skipped it (you can confirm via `farm_capabilities` →
`optionalDeps.tesseractAvailable`):

```powershell
npm install tesseract.js
```

Then run evidence collection with OCR enabled:

```powershell
node .\dist\cli.js evidence-run --url <url> --ocr --ocr-language eng --ocr-min-confidence 50
```

## Evidence Semantics

OCR output is a derivative of a registered screenshot artifact. It does not
replace the screenshot. The workflow records:

- source screenshot artifact ID and path
- timestamp when the screenshot filename encodes one
- OCR language
- minimum confidence threshold
- reported confidence and `confidenceMet`
- bounded word list with optional bounding boxes
- text profile metadata for line count, script families, digit/currency
  presence, price-like token count, percent/discount-like badges, map-like
  labels, travel/commerce-like context, rating-like text, distance/duration
  text, business-hours text, contact/address text, reservation-like text,
  menu-like text, and commerce policy-like text
- `empty_text`, `low_confidence`, `no_frames`, `unavailable`, `engine_error`,
  or `timeout` status when OCR cannot produce verified text

Price-like text detection requires a currency marker and an amount to appear as
the same visible token or adjacent phrase. A page that separately contains
`KRW` and route number `14` is not treated as price-like.
Percent or discount-like text is recorded separately, so a `15%` coupon badge
does not become a price claim unless a currency+amount token is also visible.
Map-like and travel/commerce-like flags are deterministic hints for QA and
claim review; they do not replace the underlying screenshot evidence.
The deterministic profile recognizes common Korean/Japanese map and travel
terms such as business hours, reviews, phone, parking, lowest price, rates,
tax-included pricing, and free cancellation. Numeric route labels, exit
numbers, minutes, and ratings are not price claims unless a currency+amount
token is visible. Ratings, walking times, business hours, phone, and address
text are recorded as separate map/local OCR context so reviewers can distinguish
place-card facts from price facts. Reservation, menu, cancellation, refund,
return, shipping, tax, fee, seller, and warranty text are also recorded as
separate context so visible CTA/policy evidence does not get flattened into a
generic travel/commerce flag.

Only OCR text artifacts with `status = ok` can become verified OCR claims.
Per-frame OCR engine failures are preserved as partial `ocr_text` metadata
artifacts with the source frame ID/path, timestamp when available, empty text
profile, and bounded error reason. A failed or timed-out frame does not by
itself prevent later frames from being processed.

## Live Integration Harness

Normal `npm test` does not require `tesseract.js`. To run the live OCR harness:

```powershell
npm install tesseract.js
$env:FARM_OCR_INTEGRATION="1"
npm run test:ocr-integration
```

The integration harness renders local screenshots with OCR text, map-label
text, travel-price text, and coupon/discount badge text, then verifies that the
optional OCR engine can process real images and produce the expected
text-profile metadata. It is separate from unit tests because OCR engine
downloads and language data can be slow and environment sensitive.

Set `FARM_OCR_NON_ENGLISH=1` together with `FARM_OCR_INTEGRATION=1` to include
the Korean/Japanese map-text fixture with `eng+kor+jpn`. Keep this opt-in unless
the local OCR engine has the required language data.
