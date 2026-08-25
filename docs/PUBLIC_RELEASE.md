# 외부 공개 가이드 — 라이센스와 공개 절차 상세

> 작성 2026-08-25. 이 문서는 저장소를 GitHub public + npm 공개 패키지로 운영하기 위한
> 라이센스 설명과 공개 절차/체크리스트를 담는다. 빌드/테스트 상태의 단일 진실은
> [STATUS.md](../STATUS.md), 보안 신고 창구는 [SECURITY.md](../SECURITY.md).

## 1. 라이센스: Apache License 2.0

이 프로젝트는 **Apache-2.0**으로 공개한다 (2026-05 결정, `LICENSE` + `NOTICE` + 각
릴리스의 `package.json license 필드`로 적용됨).

### 왜 Apache-2.0인가 (MIT/GPL 대비)

| 축 | Apache-2.0 (선택) | MIT | GPL 계열 |
| --- | --- | --- | --- |
| 상업적 사용/수정/재배포 | 허용 | 허용 | 허용(조건부) |
| **명시적 특허 라이센스** | **있음 (§3)** | 없음(암묵 논쟁 여지) | v3만 명시 |
| 특허 보복 조항 | 있음 — 특허 소송 걸면 라이센스 종료 | 없음 | 있음(v3) |
| 카피레프트(소스 공개 강제) | 없음 | 없음 | 있음 |
| 기업 채택 장벽 | 낮음 | 낮음 | 높음 |

이 도구의 핵심 가치는 "증거 게이트/봉인 방식"이라는 **방법**에 있고, 그 방법이 특허
분쟁 없이 널리 쓰이는 것이 목적에 부합한다. Apache-2.0의 명시적 특허 조항(§3)은
기여자·사용자 양쪽에 특허 안전망을 주고, 카피레프트가 없어 다른 에이전트
스택(사내 도구 포함)에 부담 없이 편입될 수 있다.

### 사용자가 지는 의무 (재배포 시)

Apache-2.0 §4에 따라, 이 코드를 재배포하는 사람은:

1. `LICENSE` 사본을 함께 배포해야 한다.
2. 수정한 파일에는 수정했다는 표시를 해야 한다.
3. `NOTICE` 파일이 있으므로, 재배포물에 NOTICE의 귀속 문구를 유지해야 한다.
4. 원본의 저작권/특허/상표/귀속 고지를 제거하면 안 된다.

단순 **사용**(설치해서 돌리는 것)에는 아무 의무가 없다. 상표권은 부여되지 않는다
(§6) — "browser-agent-mcp-farm"이라는 이름으로 파생물을 공식인 척 배포하는 것은
라이센스가 허용하지 않는다.

### 저작권 표기

- `LICENSE` 말미 boilerplate: `Copyright 2026 이지범`
- `NOTICE`: 패키지명 + 저작권 + 런타임 의존성 라이센스 요약

### 서드파티 라이센스 현황 (2026-08-25 검증)

배포되는 런타임 의존성은 전부 permissive — **카피레프트 0건, 라이센스 충돌 없음**:

| 패키지 | 라이센스 | 비고 |
| --- | --- | --- |
| @modelcontextprotocol/sdk | MIT | |
| playwright / playwright-core | Apache-2.0 | 브라우저 바이너리(Chromium)는 별도 라이센스로 다운로드됨 |
| zod | MIT | |
| tesseract.js | Apache-2.0 | optionalDependency (OCR) |

devDependencies(biome, vitest, typescript 등)는 배포물에 포함되지 않으므로 배포
라이센스 의무와 무관하다. 새 런타임 의존성을 추가할 때는 GPL/AGPL/SSPL 계열을
피하고, 추가 시 `NOTICE`의 목록을 갱신한다.

## 2. 공개 범위 — 무엇이 나가고 무엇이 안 나가는가

- **나가는 것**: git 추적 파일 249개 전부 + 전체 커밋 히스토리. 2026-08-25 점검:
  히스토리에 `research/`(연구 산출물) 추적 이력 0건, 하드코딩 시크릿 스캔 0건,
  팩 크기 1.5MiB(대용량 이진물 없음). 커밋 메시지가 한국어인 것은 문제 아님.
- **안 나가는 것**: `research/`(2026-07-20부터 gitignore), 로컬 프로필/스토리지
  스테이트(`~/.gstack/browser-profiles/`), `.status/` 로컬 산출물.
- **이미 공개되는 개인정보**: `package.json`의 author 이메일(ezboom1111@gmail.com)과
  커밋 author. npm 0.6.1/0.7.0 게시로 이미 공개된 정보와 동일 — 신규 노출 없음.
- npm 배포물은 `package.json`의 `files` 필드가 화이트리스트로 제한한다
  (`dist`, `skills`, 최상위 문서, docs 일부). `npm pack --dry-run`으로 배포 직전
  내용 확인 가능.

## 3. 공개 절차 체크리스트 (순서대로)

### 3.1 CI를 그린으로 (공개 저장소의 빨간 배지는 신뢰를 깎는다)

- [ ] lockfile 복원 커밋: Windows npm이 지운 `@emnapi/core`·`@emnapi/runtime`을
      package-lock.json에 복원 (미복원 시 Linux `npm ci`가 EUSAGE로 즉사 —
      2026-06-19 fc5da4e와 동일 패턴). **Windows에서 lockfile 재생성 금지, 외과 수정만.**
- [ ] 커버리지 플랫폼 편차 수정 커밋: vitest.config.ts가 non-win32에서 임계값 1pp
      slack 적용 (Linux CI는 win32 전용 경로를 실행하지 않아 같은 커밋이 ~0.5pp
      낮게 측정됨 — 2026-06-26 런에서 Windows 잡 2개 통과 / Ubuntu 잡 2개 실패로 실측).
- [ ] `npm run verify` 로컬 통과 확인 후 push → Actions 4개 워크플로(ci/verify/qa/release)
      그린 확인.

### 3.2 저장소 정리

- [ ] README.md 전면 재작성본 커밋 (2026-08-25) — 기존 README는 ①삭제 공지가 첫
      블록 ②"Out of scope: published npm distribution"인데 실제로는 npm에
      0.6.1/0.7.0 게시됨 ③"Node 24+" vs engines `>=22` 모순 ④사내용 GStack 섹션
      ⑤런타임 경로가 0.8.0에서 삭제된 multi-vantage 언급 — 전부 해소.
- [ ] `NOTICE`, `SECURITY.md`, `docs/PUBLIC_RELEASE.md`(이 문서) 커밋.
- [x] 공개 문서 부패 정리:
  - `AGENTS.md`에서 머신별 경로·백업 파일명·삭제된 런타임 모듈 설명 제거.
  - `docs/CAPTURE_BINDING.md`에서 multi-vantage를 비교 코어(런타임 오케스트레이터
    없음)로 정정.
  - `docs/ARCHITECTURE.md`와 `docs/DOCUMENTATION_MAP.md`에서 제거된
    source-navigation 스택을 현행 기능처럼 안내하던 부분 정정.
- [ ] GitHub repo description + topics 설정 (현재 비어 있음):
      `gh repo edit --description "..." --add-topic mcp --add-topic evidence --add-topic browser-automation --add-topic playwright --add-topic provenance`
- [ ] 미푸시 커밋 push (`1054bf6` gitignore, `cb1b70d` 0.8.0 + 이번 수정들).

### 3.3 공개 전환 (되돌리기 어려움 — 마지막에)

- [ ] `gh repo edit ezboom1111/browser-agent-mcp-farm --visibility public`
      ⚠️ 공개 전환은 **히스토리 전체**가 즉시 공개되고, 포크/캐시가 생기면 사실상
      되돌릴 수 없다. 위 2절 점검이 끝난 뒤에만.
- [ ] Settings → Security → **Private vulnerability reporting 활성화**
      (SECURITY.md가 이 창구를 안내하고 있음).
- [ ] (선택) branch protection: main에 PR/status check 요구.

### 3.4 릴리스와 npm

현재 npm에는 0.6.1, 0.7.0이 게시되어 있고(수동), 0.8.0은 미게시.

- [ ] 태그 릴리스: `git tag v0.8.0 && git push --follow-tags` → release.yml이
      풀 verify 후 GitHub Release 생성.
- [ ] npm 게시 — 둘 중 하나:
  - 수동(현행): 로컬에서 `npm publish` (npm 로그인 되어 있음), 또는
  - 자동: repo secret `NPM_TOKEN`(npm automation token) 등록 → 이후 태그 push만으로
    release.yml이 `npm publish --access public`까지 수행. **토큰은 automation
    token으로 만들고 2FA-bypass 범위 최소화.**

## 4. 공개 후 운영 원칙

- 버전은 semver, 태그 릴리스만 npm에 게시. `prepublishOnly`가 풀 verify 게이트를
  강제하므로 깨진 패키지가 나가는 것을 막는다.
- 보안 이슈는 SECURITY.md 절차(사적 신고)로만. 위협 모델의 정직한 한계
  (docs/THREAT_MODEL.md — "게이트는 위조-캡처를 못 막는다")는 숨기지 말 것:
  이 정직성이 이 도구의 차별점이다.
- 외부 기여를 받게 되면: PR에 CI 통과 요구, 새 의존성은 라이센스 확인(2절),
  대규모 기여 전에는 CONTRIBUTING.md를 추가.
