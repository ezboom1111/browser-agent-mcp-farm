# Browser-Agent MCP Farm

[![CI](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/ci.yml/badge.svg)](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/ci.yml)
[![qa (anti-hallucination fuzz)](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/qa.yml/badge.svg)](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/qa.yml)
[![npm](https://img.shields.io/npm/v/browser-agent-mcp-farm.svg)](https://www.npmjs.com/package/browser-agent-mcp-farm)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

> English README: [README.md](./README.md)

**AI 에이전트를 위한 변조 증거(tamper-evident) 웹 증거 서버.** 브라우저가
실제로 본 것을 캡처해 모든 산출물을 SHA-256으로 등록하고, **등록된 바이트와
다시 대조되지 않는 인용 주장을 실패시키며**(cite-or-fail), Merkle 루트로 봉인된
(선택적으로 Ed25519 서명된) 증거 번들을 내보냅니다 — 받은 쪽은 **완전히
오프라인으로** 재검증합니다. MCP(Model Context Protocol) 서버 + CLI로
제공됩니다.

이것은 **또 하나의 브라우저 드라이버가 아닙니다.** Playwright MCP, Chrome
DevTools MCP, 브라우저 확장형 에이전트들이 이미 웹을 잘 구동합니다. 이 farm은
그 **옆에 놓이는 검증 레이어**입니다: 수집은 어디서든 하되, 결론을 지탱하는
소수의 핵심 주장(load-bearing claims)만 여기서 봉인하세요. 그러면 "모델이
봤다고 말했다"가 "여기 바이트가 있고, 해시가 있고, 그 안에 인용문이 있으며,
나를 믿지 않고도 재검증할 수 있는 번들이 있다"로 바뀝니다.

## 30초 코드 검토 경로

| 검토 질문 | 먼저 볼 곳 |
| --- | --- |
| 만들어낸 인용문이 실제로 실패하는가? | [`src/claim-gate.ts`](src/claim-gate.ts), [`tests/claim-gate.test.ts`](tests/claim-gate.test.ts) |
| 두 번째 에이전트가 인수인계를 오프라인 검증할 수 있는가? | [`src/evidence-bundle.ts`](src/evidence-bundle.ts), [`tests/evidence-exchange.test.ts`](tests/evidence-exchange.test.ts) |
| 브라우저 행동이 제한되는가? | [`src/browser-pool.ts`](src/browser-pool.ts), [`src/lease-manager.ts`](src/lease-manager.ts)와 테스트 |
| 한계를 숨기지 않았는가? | [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), [`SECURITY.md`](SECURITY.md) |
| 같은 결과를 재현할 수 있는가? | `npm ci && npm run verify`; Ubuntu/Windows, Node 22/24에서 같은 게이트 실행 |

개인 프로젝트이므로 공개 근거는 팀 규모나 운영 사용을 과장하는 문구가 아니라,
구현 코드·적대적 fixture·생성된 상태 문서·재현 가능한 CI입니다.

## 왜 필요한가

에이전트는 브라우징한 뒤 단정합니다. 그 출력이 실제 의사결정·문서·분쟁에
쓰일 때 세 가지 실패 모드가 문제가 됩니다:

1. **환각 인용** — 인용된 페이지에 그런 말이 없었다.
2. **조용한 변조** — 캡처 후 저장된 증거가 바뀌었다.
3. **검증 불가능한 인수인계** — 두 번째 에이전트(또는 사람 검토자)가 첫
   에이전트의 증거를 재작업 없이 재확인할 방법이 없다.

farm은 이를 결정론적 바닥(deterministic floor)으로 막습니다: 모든 산출물은
캡처 시점에 해시 등록되고, 주장은 등록된 타입 있는 산출물을 인용해야 하며,
앵커된 주장의 인용문(`text_span`)은 인용된 바이트 안에 실제로 존재해야 하고,
인용 없는/불일치 주장이 있으면 **런 자체가 실패**하며, 내보낸 번들은 내보내는
순간 자체 검증되고 받은 쪽에서 다시 오프라인 검증됩니다.

인접 도구들은 인접한 문제를 풉니다: C2PA/Content Credentials는 **미디어
자산**을 생성 시점에 서명하고, WACZ/서명된 웹 아카이브는 **페이지 아카이브**를
봉인하며, zkTLS/TLSNotary는 **TLS 세션**을 증명합니다. farm은 그 사이의
공백 — **주장(claim) 단위·에이전트 통합(MCP)·로컬 검증 가능한 웹 증거** —
에 위치하며, 이들을 대체하지 않고 상호운용하도록 설계됐습니다.

## 무엇을 증명하고, 무엇을 증명하지 않는가

이 프로젝트는 자신의 한계를 기능으로 취급합니다. 요약은 아래 표, 전체는
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md):

| | 증명함 | 증명하지 않음 |
| --- | --- | --- |
| **클레임 게이트** | 등록된 모든 산출물의 바이트가 기록된 SHA-256과 일치(게이트 시점 재해시); 모든 최종 주장이 등록된 타입 있는 산출물을 인용; 앵커된 주장의 인용문이 인용된 바이트 안에 실존 | 캡처된 바이트가 라이브 페이지를 충실히 반영한다는 것(악의적 *생산자*는 위조 바이트를 등록할 수 있음); 앵커 없는 주장이 참이라는 것; 원장 밖 자유 텍스트에 대한 어떤 것도 |
| **증거 번들** | 오프라인으로: 매니페스트의 모든 산출물이 존재하고 해시 일치; Merkle 루트 재계산 일치; 공개키가 있으면 해당 개인키 보유자가 서명했다는 것 | 봉인된 바이트가 라이브 웹의 충실한 기록이라는 것 — 서명은 *누가 봉인했는지*를 증언하지 *무엇이 참인지*를 증언하지 않음 |

초록 게이트는 *"이 증거는 내적으로 일관되고, 바이트가 안정적이며, 주장이
증거에 근거해 있다"*로 읽으세요 — 절대 *"이 답이 참이다"*로 읽지 마세요.
참인지는 최고 이해관계 수치를 독립 소스들로 교차 검증해야 하고, 원본
바인딩(바이트가 origin 서버에서 왔다는 증명)은 아래 옵트인 캡처-바인딩
티어와 그 정직한 한계를 보세요.

## 설치 & 60초 퀵스타트

Node.js **22+** 필요(CI는 22와 24에서 테스트). Chromium은 첫 `serve` 때 없으면
자동 설치됩니다(`FARM_SKIP_BROWSER_AUTOINSTALL=1`로 거부 가능).

**npm에서 (권장):** Claude Code / Codex에 이식성 있는 `npx` 호출을 등록 —
호스트 설정에 빌드 경로가 남지 않고 업그레이드는 패키지 매니저로 흐릅니다:

```sh
npx -y browser-agent-mcp-farm@latest register-all --npx
# 버전 고정 / 스코프:  ... register-all --npx --package-spec browser-agent-mcp-farm@0.8.0
```

**클론에서 (개발):**

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
node ./dist/cli.js register-all        # 이 빌드의 절대경로를 등록
```

(Windows `./install.ps1` / macOS·Linux `sh install.sh`가 위 단계 +
`register-all`을 한 번에 실행하며, 설정 파일은 타임스탬프 백업 후 수정.)

에이전트를 재시작하고 확인: `claude mcp get browser-agent-mcp-farm`.
도구는 `mcp__browser-agent-mcp-farm__farm_*`로 나타납니다.

CLI로 클레임 게이트가 걸린 캡처 한 번:

```sh
node ./dist/cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
```

에이전트에서는 `farm_evidence_run`에 `{ "url": "https://example.com/" }`를
호출한 뒤 반환된 `reportPath`로 `farm_read_report`를 부르면 됩니다. 전체
에이전트 플레이북은
[`skills/browser-agent-mcp-farm/SKILL.md`](skills/browser-agent-mcp-farm/SKILL.md)
(`register-all`이 Claude에 자동 설치; 업그레이드 후 `serve`가 스스로 갱신).

## 핵심 루프: cite-or-fail

farm의 가장 강력한 사용법은 **어떤 방식으로 수집했든 그 위에 얹는 검증
레이어**입니다:

```text
1. 바이트 캡처/등록        farm_evidence_run { url }                      (farm이 캡처)
                           farm_register_evidence { text | bytesBase64 }  (직접 캡처한 것 — BYO)
2. 바이트에 대한 주장 작성  farm_add_claim { claim, artifactId,
                                             anchor: { type: "text_span", quote } }
3. 게이트                  farm_run_claim_gate { strictProvenance: true }
                           → 인용문이 인용된 바이트에 없으면 런이 실패
4. 봉인                    farm_export_bundle { runDir }   (내보내기 전 자체 검증)
5. 인수인계                farm_verify_bundle — 누구든 오프라인으로 재확인
```

환각 인용은 3단계를 통과할 수 없습니다: 게이트가 등록된 바이트를 다시 읽어
주장을 기각합니다. `strictProvenance`는 추가로, farm이 파생한 구조화 추출이
아닌 **에이전트가 스스로 작성한 "구조화 데이터"**(자기 주장 JSON)를 인용하는
주장을 하드 실패시킵니다 — 실측으로 확인된 "뉴스를 JSON으로 재포장" 구멍을
막는 장치입니다.

### 에이전트 간 검증 가능한 교환 (worked example)

자기완결형 `.evb` 아카이브는 한 에이전트가 다른 에이전트의 증거를 **생산자가
아니라 해시를 믿고** 수용하게 합니다:

```sh
# 에이전트 A (증거를 캡처, 개인 서명키 보유)
node dist/cli.js export-bundle --run-dir <A-run> --archive-file bundle.evb \
  --private-key-env A_SIGNING_KEY

# 에이전트 B는 bundle.evb + A의 공개키만 받음 — 런 디렉터리도 브라우저도 없음
node dist/cli.js verify-bundle --archive-file bundle.evb --public-key-env A_PUBLIC_KEY
# -> { ok: true, complete: true, merkleMatches: true, signatureValid: true }
```

B는 내장된 바이트를 재해시하고, Merkle 루트를 재계산하고, A의 서명을 **완전히
오프라인으로** 확인합니다. 전송 중 바이트가 바뀌면 `tamperedArtifacts`,
가짜 키 서명이면 `signatureValid: false`. 성공 기준은 "협력하는 두 번째
에이전트 하나가 검증할 수 있다"이지 "온 세상이 합의한다"가 아닙니다 —
`tests/evidence-exchange.test.ts`에 A→B 실제 예제가 있습니다.

## MCP 도구 표면 (32종)

| 그룹 | 도구 |
| --- | --- |
| 원샷 워크플로 | `farm_evidence_run`, `farm_read_report` |
| 수동 캡처 | `farm_acquire_context`, `farm_open_page`, `farm_capture`, `farm_capture_after_idle`, `farm_wait`, `farm_wait_for_selector`, `farm_scroll`, `farm_sample_frames`, `farm_close_page`, `farm_release_context`, `farm_heartbeat` |
| 쓰기 액션 (리스 `capability: "read-write"` 필요; 결제 페이지는 항상 거부) | `farm_click`, `farm_fill`, `farm_press`, `farm_select_option` |
| cite-or-fail 저작 | `farm_register_evidence`, `farm_register_transcript`, `farm_add_claim`, `farm_judge_claim` |
| 검증 (브라우저 불필요) | `farm_run_claim_gate`, `farm_list_runs`, `farm_list_artifacts`, `farm_read_artifact` (읽을 때 재해시), `farm_capabilities` |
| 봉인 & 구조화 | `farm_export_bundle`, `farm_verify_bundle`, `farm_extract_structured` |
| 리서치 렌즈 & 운영 | `farm_lens`, `farm_list_leases`, `farm_reap_expired` |

`farm_lens`는 선언적 클레임 타입 렌즈를 제공합니다: `market_scan`
(`competitor_price`, `review_sentiment`, `market_figure` — 마지막 것은
**독립 등록 도메인 ≥2곳의 교차 검증**을 요구하고 각 소스의 바이트와 대조),
`product_planning`(`user_pain`, `feature_gap`, `adoption_figure`).

## CLI

같은 엔진의 스크립트판. 주요 명령(전체: `browser-agent-mcp-farm help`):

| 명령 | 용도 |
| --- | --- |
| `serve` / `serve-http` | MCP stdio 서버 / 로컬 HTTP 잡 큐(`/health`, `/evidence-run`, `/jobs`) |
| `evidence-run` | 캡처 → 타입 있는 산출물 → 주장 → 최종 게이트, 한 명령으로 |
| `claim-gate` | 런 재검증; `--strict-provenance`, `--mode final`, 실패 시 non-zero 종료 |
| `export-bundle` / `verify-bundle` | Merkle 매니페스트 또는 자기완결 서명 `.evb`; `--anchor-log`는 루트를 해시체인 투명성 로그에 추가 |
| `verify-decision-log` / `verify-timestamp-log` | 게이트 판정/투명성 로그의 해시 체인 검증 |
| `scan-secrets` | 완료된 런에서 잔류 시크릿 스캔(발견 시 non-zero) |
| `purge-run` / `prune-runs` / `archive-run` | 보존 정책: 삭제, 기간/용량 스윕, 계층 아카이브 |
| `auth-login` / `auth-cdp-launch` / `auth-cdp-import` | 동의 기반 로그인 프로필(보이는 브라우저; 또는 본인 Chrome에서 DevTools 포트로 쿠키 가져오기) |
| `profile-list` / `profile-remove` | 저장된 프로필 관리 |
| `smoke` / `smoke-web` / `smoke-media` / `smoke-proxy` | 픽스처/공개 페이지 스모크 캡처 |
| `html-preview` | 런 증거의 사람용 미리보기 생성 |
| `platform-capabilities` / `official-api-readiness` | 플랫폼 URL별 증거 경로 지도; 자격증명 env 준비 상태(토큰 값은 절대 출력 안 함) |
| `register-claude` / `register-codex` / `register-all` | 호스트 등록(`--npx` 지원); 설정 파일은 타임스탬프 백업 |
| `upgrade` | 설치 버전 + 업그레이드/재등록 안내 |

유용한 `evidence-run` 옵션: `--http-fetch`(브라우저 없는 tier-0 GET),
`--auto-capture`(tier-0 먼저, *어떤* 거절이든 브라우저로 승격),
`--capture-cache`(≤1시간 이전 캡처를 콘텐츠 해시로 재사용, `cached_capture`
라벨+경과시간 기록), `--text-only`, `--headed`, `--profile <name>` /
`--persistent-profile`, `--ocr`(+`--ocr-language`, `--ocr-min-confidence`),
`--dense-sampling`(자막 큐/OCR/장면전환 히트 주변 추가 프레임),
`--official-api`(자격증명은 env 변수 *이름*으로만), `--intent` /
`--intent-scope` / `--intent-shapes` / `--success-criteria`(소프트 의도 잠금
→ `intent_profile` 산출물). 공개 페이지의 비종결 실패는 합법적 공개
게이트웨이(Wayback 최신 스냅샷)로 폴백하며, 로그인/페이월/CAPTCHA/연령/지역
게이트는 종결로 남습니다(우회하지 않음).

## 런이 기록하는 것

`evidence-run`은 파생하는 모든 것을 타입 있는 해시 등록 산출물로 남깁니다:
페이지 텍스트/HTML/스크린샷, 타임스탬프 프레임 샘플(원본 스트림 다운로드는
절대 안 함), WebVTT 자막 큐, OCR 패스(등록된 스크린샷의 *파생물*로서 언어·
신뢰도·텍스트 프로파일 메타데이터 포함), 구조화 추출(JSON-LD/Open Graph/
가격·평점), 획득 방법 계획, 공식 API 준비 상태, 소스 전략, 장애물
분류(로그인월·봇차단·지역/연령 게이트 — 콘텐츠 접근 성공으로 **위장하지
않고** 장애물로 기록), 오버레이 해제 증거, 단계별 소요 시간. 주장과 인용은
append-only 원장에 쌓이고, 최종 클레임 게이트가 마지막에 돌아 인용 없는/
불일치 주장이 있으면 런을 실패시킵니다.

## 인증 캡처 — 동의 우선

로그인이 필요한 사이트는 운영자가 **직접, 한 번**, 보이는 브라우저에서
로그인합니다(`auth-login`, 또는 본인 Chrome에서 `auth-cdp-launch`/
`auth-cdp-import`로 쿠키 가져오기). 저장된 프로필은
`~/.gstack/browser-profiles/<profile>/` 아래 소유자 전용 디렉터리(POSIX
`0700` / Windows ACL)에 살고, Windows에서는 `FARM_ENCRYPT_STORAGE_STATE=1`로
스토리지 스테이트를 DPAPI(CurrentUser)로 감쌉니다 — 유휴/오프라인 사본을
보호하며, 같은 사용자로 실행 중인 코드까지 막지는 않습니다(정직하게 문서화).
프로필당 활성 리스 1개가 온디스크 락으로 **프로세스 간** 강제되어, 병렬
워커들이 쿠키 저장소를 서로 덮어쓰는 일이 없습니다.

## 안전 경계 (문구가 아니라 코드로 강제)

- **로그인/CAPTCHA/페이월/연령게이트 우회 없음.** 벽은 장애물로 분류·기록되고,
  동의된 프로필만이 인증 경로입니다.
- **결제/예약/계정변경 자동화 없음** — 결제성 URL·셀렉터·요소 텍스트
  (`checkout`, `cvv`, `pay now`, `결제`, …)에 대한 쓰기 액션 차단.
- **원본 영상/음성 스트림 다운로드 없음**, 그리고 대응하는 전사/프레임
  산출물 없이 영상·음성 이해를 주장하지 않음. farm은 음성 인식을 하지
  않습니다(명시적 non-goal) — 캡처된 자막은 `transcript_cue`로 등록될 뿐,
  전사를 지어내지 않습니다.
- 모든 소스 레지스트리 항목은 `legalBasis`(`public_browser_visible`,
  `official_api`, `user_provided`, `derivative_citation`, `planning_only`)로
  의도된 합법 접근 자세를 기록합니다.

## 보안 자세

- **기본 최소권한**: 리스는 기본 읽기 전용, 리스별 도메인 allowlist, 모든
  쓰기 경로에 결제 가드.
- **HTTP 모드는 인증됨**: `serve-http`는 토큰 없이 비-루프백 호스트에서 기동
  거부; `FARM_HTTP_TOKEN`(또는 `--token`) 설정 시 모든 요청에
  `Authorization: Bearer <token>` 요구(라우트 로직 이전 401). 로컬
  오케스트레이션용이며 공유 프로덕션 서비스가 아닙니다.
- **작은 공급망**: 런타임 의존성 3개(`@modelcontextprotocol/sdk`,
  `playwright`, `zod`) + 선택적 `tesseract.js`; 릴리스 게이트 안에서
  `npm audit` 실행.
- 시크릿: 자격증명은 CLI/MCP/HTTP 입력에 env 변수 *이름*으로만 전달되고 값은
  전달되지 않으며, `scan-secrets`가 완료된 런의 토큰 유출을 점검합니다.
- 취약점 신고: [`SECURITY.md`](SECURITY.md).

## 옵트인 캡처-바인딩 티어

기본 캡처는 그대로입니다. 옵트인 조각들이 캡처를 원본에 더 가깝게 묶습니다 —
각각 무엇을 증명하고 **증명하지 않는지**까지 문서화되어 있습니다
([`docs/CAPTURE_BINDING.md`](docs/CAPTURE_BINDING.md)):

- `FARM_BIND_TLS=1` — 최종 호스트가 제시한 TLS 인증서 기록(별도 프로브):
  인증서 핀/발급자 변경 감지.
- `FARM_BIND_TLS_SAMECONN=1` — 바이트를 실어 나른 **바로 그 소켓**의 인증서
  기록(tier-0 HTTP 경로).
- `export-bundle --anchor-log` — 검증된 Merkle 루트를 해시체인 투명성 로그에
  추가(절대 시각이 아니라 상대 *순서*를 증명; 실제 타임스탬프용 RFC-3161
  TSA 이음새는 마련되어 있음).

이들 중 무엇도 스스로 신뢰를 승격시키지 않습니다 — 결정론적 게이트가 신뢰
경계로 남습니다. 완전한 원본 바인딩(악의적 로컬 생산자에 맞서 바이트가
origin 서버에서 왔음을 증명)은 중립 공증인(zkTLS 계열)을 요구하며, 그 경계는
덮어 가리지 않고 문서화되어 있습니다
([`docs/ORIGIN_BINDING_DESIGN.md`](docs/ORIGIN_BINDING_DESIGN.md)).

## 품질 게이트

`npm run verify` = 빌드 → 타입체크 → 린트 → **의존성 경계 가드**(브라우저/
리스 프리미티브는 플랫폼 로직을 절대 import 못 함 — 빌드로 강제) → 테스트 +
커버리지(단조 상승 래칫) → 스모크 캡처 4종 → 패키지 타르볼 테스트 →
`npm audit` → 상태 생성. CI는 같은 게이트를 Ubuntu/Windows × Node 22/24에서
돌립니다. 현재 수치는 생성 파일 [`STATUS.md`](STATUS.md) /
[`SCORECARD.md`](SCORECARD.md)가 단일 진실이며, 여기 다시 적지 않는 것이
원칙입니다.

cite-or-fail 경계 자체는 버전 관리되는 시드 결정론적 퍼즈 코퍼스로 회귀
테스트됩니다(`npm run qa:fuzz`, CI 하드 게이트): 현재 **위조/근사/재조합
1,200회 시도에서 환각 유출 0건**. 어려운 케이스는 시드를 추가해서만 늘리고,
제거하지 않습니다.

## 아키텍처 (한 문단)

얇은 트랜스포트(`mcp-server`/`cli`/`http-server`) → 단일 파사드
(`farm-service`) → 범용 브라우저 프리미티브(`lease-manager`,
`browser-pool`) → 플랫폼 인텔리전스(소스 전략, 어댑터, OCR, 공식 API) → 런
오케스트레이션(`evidence-runner`) → 무결성(`claim-gate`). 하드 룰 하나:
**프리미티브는 상위 레이어를 절대 import하지 않는다**(`npm run boundaries`가
위반 시 빌드 실패). 상세: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## 개발 방식 (이 저장소가 만들어진 방법)

이 프로젝트는 **두 코딩 에이전트(Codex, Claude)가 공동 편집하고, 사람이
총괄하는** 방식으로 개발됐습니다 — 아키텍처 결정·범위·완료 판정은 사람이,
구현은 에이전트가. 그리고 그 방식 자체가 이 도구의 주제와 맞물립니다:
**AI의 출력을 신뢰로 받지 않는다**는 원칙을 개발 프로세스에도 적용해,

- 에이전트 간 경계 침범은 **빌드가 강제하는 의존성 경계 가드**로 차단하고,
- "완료" 주장은 **결정론적 verify 게이트**(빌드+타입+린트+테스트+스모크+감사)
  통과로만 인정하며,
- 기능 주장("환각을 막는다")은 **적대적 퍼즈 코퍼스**(1,200회, 유출 0)로
  회귀 검증하고,
- 측정 수치는 손으로 쓰지 않고 **생성 파일(STATUS/SCORECARD)만 단일 진실**로
  둡니다.

같은 이유로 문서는 능력의 한계를 먼저 적습니다(위협 모델, 캡처-바인딩의
"증명하지 않는 것" 열). 이 정직성이 검증 도구의 전제 조건이라고 보기
때문입니다.

## 호스트 통합

두 모드, [`HOST-ADAPTERS.md`](HOST-ADAPTERS.md)에 문서화:

- **모드 A — 부모 주도**(기본, 가장 안전): 부모 에이전트가 farm 도구를 쥐고
  캡처하며, 저장된 산출물을 분석 서브에이전트에게 넘깁니다.
- **모드 B — 브라우저-워커 서브에이전트**: 호스트가 워커에게 farm MCP 도구를
  명시적으로 부여할 수 있을 때만; 워커당 과제 1개 + 도메인 allowlist, 자기
  `agentId`, `finally`에서 리스 해제, 다른 워커의 컨텍스트 토큰 재사용 금지.

## 문서

| 문서 | 내용 |
| --- | --- |
| [`skills/browser-agent-mcp-farm/SKILL.md`](skills/browser-agent-mcp-farm/SKILL.md) | 에이전트용 플레이북(도구 흐름, 렌즈 클레임 타입, 거부선) |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | 게이트/번들이 증명하는 것과 못 하는 것 |
| [`docs/CAPTURE_BINDING.md`](docs/CAPTURE_BINDING.md) | 옵트인 프로비넌스 조각들, 출하 vs 의도적 보류 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 레이어링 + 빌드 강제 경계 규칙 |
| [`docs/OFFICIAL_API.md`](docs/OFFICIAL_API.md) / [`docs/OCR.md`](docs/OCR.md) | 선택적 자격증명 API·OCR 표면 |
| [`docs/QA_QC_PROCESS.md`](docs/QA_QC_PROCESS.md) | 품질 게이트와 "검증됨"의 정의 |
| [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md) | 라이센스 상세·공개 절차(한국어) |
| [`docs/DOCUMENTATION_MAP.md`](docs/DOCUMENTATION_MAP.md) | 전체 문서 색인 |
| [`CHANGELOG.md`](CHANGELOG.md) | 버전별 변경(semver) |

## 범위와 non-goal

범위: 로컬 캡처-검증 슬라이스 — 리스, 동의 기반 캡처, 해시 등록 타입
산출물, 클레임 게이팅, 봉인 번들, 호스트 등록, 로컬 HTTP 큐.

영구 범위 밖: 결제 액션; DRM 우회·원본 영상/음성 다운로드; 로그인/CAPTCHA/
페이월 우회; 프로덕션 멀티테넌트 원격 서비스. (역사 노트: 사이트별 셀렉터/
레시피 서브시스템은 2026-06에 의도적으로 절제 — 셀렉터 레시피는 썩고, 모델
비전 + 동의 브라우저가 대체. `docs/SELECTOR_STACK_EXCISION.md`에 결정 기록.)

## 라이센스

[Apache-2.0](./LICENSE) © 2026 이지범 — 명시적 특허 조항, 카피레프트 없음,
귀속용 [`NOTICE`](./NOTICE) 포함. 런타임 의존성은 전부 MIT/Apache-2.0.
재배포자를 위한 상세: [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md).
