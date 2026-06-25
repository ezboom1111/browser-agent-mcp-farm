# Official API Setup

Official API collection is opt-in. Evidence runs may record credential
readiness for supported platforms before browser capture, but provider API calls
only happen when `--official-api` or the equivalent API/MCP option is explicitly
enabled. The farm records credential requirements and permission failures as
artifacts, but it does not treat official API data as available unless explicit
environment-variable references are provided.

The token value itself must be stored in the environment. CLI/MCP/HTTP inputs
should pass only the environment variable name.

Readiness artifacts use `capture_method=browser-agent-mcp-farm
official-api-readiness` and `evidence_kind=source_strategy`. They are planning
evidence: they show which official lookups are possible, which credential env
var references are missing or unset, and whether a stable media ID is available.
They do not prove provider metadata and do not call provider APIs.

## YouTube

Metadata:

```powershell
$env:FARM_YOUTUBE_API_KEY="..."
node .\dist\cli.js evidence-run --url https://www.youtube.com/watch?v=dQw4w9WgXcQ --official-api --youtube-api-key-env FARM_YOUTUBE_API_KEY --no-frames --wait-ms 0
```

Caption track metadata:

```powershell
$env:FARM_YOUTUBE_OAUTH_TOKEN="..."
node .\dist\cli.js evidence-run --url https://www.youtube.com/watch?v=dQw4w9WgXcQ --official-api --youtube-oauth-token-env FARM_YOUTUBE_OAUTH_TOKEN --no-frames --wait-ms 0
```

Notes:

- `videos.list` uses an API key and can verify video metadata.
- `captions.list` uses OAuth and returns caption track metadata, not caption
  body text.
- Caption body download remains rights- and scope-gated. Third-party videos
  must stay unavailable unless credentials and rights are actually present.

## Instagram

```powershell
$env:FARM_INSTAGRAM_ACCESS_TOKEN="..."
$env:FARM_INSTAGRAM_MEDIA_ID="178..."
$env:FARM_INSTAGRAM_MEDIA_URL="https://www.instagram.com/p/178.../"
node .\dist\cli.js evidence-run --url $env:FARM_INSTAGRAM_MEDIA_URL --official-api --instagram-token-env FARM_INSTAGRAM_ACCESS_TOKEN --no-frames --wait-ms 0
```

Notes:

- Instagram Graph media reads are constrained by account, permissions, and
  readable media ownership.
- The current URL parser supplies the path ID as the API media ID. For
  integration testing, use a URL whose post/reel ID segment is the Graph media
  ID, or call the lower-level collector in a test harness.
- Instagram post caption metadata is not a timed transcript.

## TikTok

Display API:

```powershell
$env:FARM_TIKTOK_ACCESS_TOKEN="..."
$env:FARM_TIKTOK_USERNAME="example"
$env:FARM_TIKTOK_VIDEO_ID="1234567890123456789"
$env:FARM_TIKTOK_VIDEO_URL="https://www.tiktok.com/@example/video/1234567890123456789"
node .\dist\cli.js evidence-run --url $env:FARM_TIKTOK_VIDEO_URL --official-api --tiktok-token-env FARM_TIKTOK_ACCESS_TOKEN --no-frames --wait-ms 0
```

Research API:

```powershell
$env:FARM_TIKTOK_RESEARCH_TOKEN="..."
node .\dist\cli.js evidence-run --url $env:FARM_TIKTOK_VIDEO_URL --official-api --tiktok-research-token-env FARM_TIKTOK_RESEARCH_TOKEN --no-frames --wait-ms 0
```

Notes:

- Display API video query is generally limited to videos available to the
  authorized user.
- Research API access is approval-gated. `voice_to_text` must not be claimed as
  present unless returned and cited as an artifact.

## Integration Harness

The normal `npm test` suite never calls live official APIs.

Before running live checks, inspect credential readiness without calling any
provider API:

```powershell
node .\dist\cli.js official-api-readiness --url https://www.youtube.com/watch?v=dQw4w9WgXcQ --youtube-api-key-env FARM_YOUTUBE_API_KEY --youtube-oauth-token-env FARM_YOUTUBE_OAUTH_TOKEN
```

The readiness report shows supported lookups, credential env var references,
which referenced env vars are set, and which lookups will still be skipped or
fail before a live provider request. It never prints token values and it does
not validate scopes, ownership, quota, or provider availability. Each lookup
also reports a `credentialStatus` and `nextAction`, so a listing page can show
that credentials are ready while the run is still blocked by a missing stable
media ID.
For supported platforms that do not expose a direct media ID in the URL, such
as YouTube search results, Instagram hashtag pages, TikTok search pages, or
profile/listing pages, readiness reports `missing_media_id`. Use
browser-visible evidence first, then run destination follow-up or a direct
media/item URL before expecting official API metadata.

Run opt-in integration checks with:

```powershell
$env:FARM_OFFICIAL_API_INTEGRATION="1"
npm run test:official-api
```

Optional environment variables:

- `FARM_YOUTUBE_API_KEY`
- `FARM_YOUTUBE_OAUTH_TOKEN`
- `FARM_YOUTUBE_VIDEO_URL`
- `FARM_INSTAGRAM_ACCESS_TOKEN`
- `FARM_INSTAGRAM_MEDIA_ID`
- `FARM_INSTAGRAM_MEDIA_URL`
- `FARM_TIKTOK_ACCESS_TOKEN`
- `FARM_TIKTOK_RESEARCH_TOKEN`
- `FARM_TIKTOK_USERNAME`
- `FARM_TIKTOK_VIDEO_ID`
- `FARM_TIKTOK_VIDEO_URL`

Each provider test is skipped unless its required env vars are present. The
harness verifies that successful API metadata is registered as
`official_api_metadata` and that raw token values are not written to
`artifacts.jsonl`.

## Secret Handling

The collector writes credential references such as `FARM_YOUTUBE_API_KEY`, not
raw token values. If an API response or error echoes a token value, the
collector redacts that value before writing metadata, text artifacts, warning
messages, and API cache entries.

When official API collection is enabled on a supported platform URL that lacks
a stable media ID, the collector writes `official_api_metadata` artifacts with
`status = missing_media_id` plus API cache entries. These artifacts record the
credential env var reference, credential readiness state, and
`nextAction = use_direct_media_url_or_followup` without making provider API
calls.

## Failure Classification

Provider failures are recorded as artifacts instead of being hidden. Error
metadata and API cache entries include `failureKind` when a live API call fails:

- `permission_denied`
- `ownership_required`
- `quota_exceeded`
- `rate_limited`
- `not_found`
- `unknown`

These classifications are diagnostic. They do not make the API evidence
available; they explain why the credentialed API path could not provide it.
