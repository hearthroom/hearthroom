<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  AI 캐릭터 카드 오픈 플랫폼: 커뮤니티 랭킹, 브라우저에서 바로 플레이하는 채팅, 커뮤니티 심사를 거친 배포.<br>
  Cloudflare Worker 하나로 실행됩니다.
</p>

<p align="center">
  <a href="https://hearthroom.club"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhearthroom.club&label=hearthroom.club" alt="Website"></a>
  <a href="https://discord.gg/C7m85YPHmK"><img src="https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml"><img src="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/hearthroom/hearthroom" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/hearthroom/hearthroom/commits/main"><img src="https://img.shields.io/github/last-commit/hearthroom/hearthroom" alt="Last commit"></a>
  <a href="https://github.com/hearthroom/hearthroom/stargazers"><img src="https://img.shields.io/github/stars/hearthroom/hearthroom?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-Hant.md">繁體中文</a> ·
  <a href="README.zh-Hans.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>한국어</b>
</p>

<p align="center">
  <img src="docs/screenshots/board-dark.png" width="800" alt="Hearthroom 랭킹 보드(다크)">
</p>

## 개요

Hearthroom은 AI 캐릭터 카드를 위한 오픈소스 플랫폼으로, 세 부분으로 구성됩니다.

- **랭킹 보드** — 작성자가 카드를 등록하고, 독자는 일간·주간·월간 랭킹, 이름·소개·태그 검색, 작성자 페이지로 카드를 찾습니다.
- **채팅** — 등재된 모든 카드를 브라우저에서 플레이할 수 있습니다. 채팅 스테이지(`stage/` 서브모듈로 포함된 별도의 오픈소스 프로젝트)가 대화, 카드의 상태 바와 패널을 그리고 카드 스크립트를 샌드박스에서 실행합니다.
- **배포** — 카드는 등재 전에 커뮤니티 심사를 거치며, 열 때 규칙, 세계관, 이미지와 함께 로드됩니다. SillyTavern PNG/JSON 카드를 가져올 수 있습니다.

SillyTavern과의 차이는 실행 위치입니다. 로컬에 설치할 것이 없고 사용자가 API 키를 설정하지도 않습니다. 로그인, 카드 저장, 텍스트 생성은 **카드 제공자**(오픈 API를 제공하는 채팅 서비스)가 담당합니다. Hearthroom이 저장하는 것은 등록 정보(어떤 카드가 등재되었는지), 심사 상태, 검색 인덱스, 사이트 설정입니다. 작성자는 제공자를 통해 로그인하고 카드 ID로 등록합니다. 사이트는 한 시간마다 제공자에서 카드의 공개 필드를 복사합니다. 카드 내용은 사이트에 저장되지 않습니다.

심사 절차: 심사자는 공유 대기열에서 신청을 가져갑니다. 첫 심사는 두 명의 승인, 재심사는 한 명의 승인이 필요하며, 한 명이라도 반려하면 반려되고, 심사 페이지에는 작성자가 표시되지 않습니다. 승인은 카드의 내용 버전에 묶입니다. 작성자가 카드를 수정하면 보드에서 내려가고 다시 대기열에 들어갑니다.

## 기능

- 일간·주간·월간 랭킹, 인기순·최신순, 태그 필터, 작성자 랭킹, 언어 구역.
- 이름, 소개, 태그 검색.
- 작성자 페이지(해당 작성자의 카드 목록).
- 카드 편집기: 인물, 첫 메시지, 세계관, 테스트 칸이 있는 정규식 규칙, 이미지 필드, 너비를 조절할 수 있는 대화 테스트 패널. SillyTavern PNG/JSON 카드 가져오기.
- 두 가지 채팅 페이지: 카드의 스타일과 스크립트를 격리하는 샌드박스 페이지(기본)와 오래된 카드를 위한 기존 페이지. 작성자용 규약은 [카드 작성 가이드](docs/guide/card-authoring.ko.md)에 있습니다.
- 커뮤니티 심사: 익명 심사, 두 명 승인, 내용 버전에 묶인 등재.
- 성인 콘텐츠의 연령 확인과 태그별 숨김.
- 데스크톱과 모바일에서 웹 앱으로 설치 가능.
- 5개 UI 언어: 번체 중국어, 간체 중국어, 영어, 일본어, 한국어.

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="랭킹 보드(라이트)">
  <img src="docs/screenshots/guide.png" width="49%" alt="카드 작성 가이드">
</p>
<p align="center"><sub>스크린샷은 데모 카드입니다.</sub></p>

## 사용하기

공개 인스턴스: [hearthroom.club](https://hearthroom.club)

1. 랭킹, 검색, 카드 페이지, 작성자 페이지는 공개입니다.
2. 카드 제공자 계정으로 **로그인**합니다. 제공자는 이 사이트용 토큰을 발급하며, 사이트는 비밀번호를 받지 않습니다.
3. **내 카드**에 제공자 쪽 카드가 나열됩니다. 하나를 골라 심사에 제출하거나 편집기에서 새 카드를 만듭니다. 작성자마다 주간 등록 한도가 있습니다.
4. [카드 작성 가이드](https://hearthroom.club/guide)는 필드, 규칙, 샌드박스 작성자 API, 다른 플랫폼에서 가져오기를 다룹니다.
5. [개발자 문서](https://hearthroom.club/developers)와 [OpenAPI 명세](docs/openapi.json)는 HTTP API를 다룹니다.

## 아키텍처

```
src/          Cloudflare Worker(Hono): 커뮤니티 API, 심사, 매시간 동기화, 공유 미리보기
web/          Vue 3 + Vite 단일 페이지 앱, 5개 언어
migrations/   D1 스키마
stage/        채팅 스테이지(git 서브모듈, 커밋 고정): /play에서 쓰는 대화 UI
docs/         개발자 문서, OpenAPI 명세, 카드 작성 가이드, 아키텍처 노트
scripts/      배포 전 점검, 에셋 보관, 심사자 권한 부여, 로컬 개발용 모의 제공자
```

API와 웹 앱은 하나의 Worker가 제공합니다. `/v1/*`는 Hono가 처리하고 나머지 경로는 빌드된 SPA로 넘어갑니다. 저장소: 등록·회원·심사는 D1, 응답 캐시와 이전 에셋 빌드(배포 전에 열린 탭이 자기 청크를 계속 로드할 수 있도록)는 KV, 사용 이벤트(선택)는 Analytics Engine. cron 트리거가 한 시간마다 제공자에서 카드 이름, 커버, 인기 카운터를 동기화합니다.

채팅 스테이지는 빌드 시 SPA에 포함됩니다. 스테이지 변경은 스테이지 자체 저장소로 보내며, 이 저장소는 고정 커밋만 갱신합니다.

개별 설계 결정과 그 이유는 [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md)(번체 중국어)에 있습니다.

## 개발

Node 22와 npm이 필요합니다. 웹 테스트는 Node 26에서 실행되지 않습니다(내장 `localStorage` 전역 때문).

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # Worker와 web 워크스페이스 설치
npm run migrate:local       # 로컬 DB에 D1 마이그레이션 적용
npm run build:stage         # 채팅 스테이지 빌드. web 빌드와 테스트에 필요
npm run dev                 # Worker, :8787
npm run dev:web             # Vite, :8850, /v1을 :8787로 프록시
```

| 명령 | 설명 |
|---|---|
| `npm test` | Worker 테스트(Vitest, Workers pool)와 web 테스트 |
| `npm run typecheck` | Worker 타입을 생성하고 두 패키지를 타입 검사 |
| `npm run build` | 스테이지와 web 앱을 빌드해 `web/dist`에 출력 |
| `npm run i18n -w web` | 언어별 번역 커버리지를 보고하고 컴포넌트 안의 미번역 문자열을 나열 |
| `npm run sync:stage` | 스테이지 업스트림 `main`을 가져와 테스트를 실행하고 다시 빌드한 뒤 서브모듈 포인터를 갱신(커밋하지 않음) |

### 제공자 계정 없이 편집기 개발하기

편집기는 제공자와의 OAuth가 필요하며 `localhost`에서는 완료할 수 없습니다. `scripts/mock-upstream.mjs`는 제공자의 인메모리 대체물로, 어떤 bearer 토큰이든 받아들입니다.

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_HARBOR_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

브라우저 콘솔에서 토큰을 설정합니다.

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

모의 제공자의 `/__log`는 받은 요청을 나열합니다. `scripts/fixtures/` 아래 파일(git 무시)은 `/fixtures/<이름>`으로 제공되어 가져오기 테스트에 쓸 수 있습니다.

## 직접 호스팅

사이트는 Cloudflare 계정 하나에서 실행됩니다. 작은 커뮤니티라면 무료 요금제로 충분합니다.

1. 리소스를 만들고 ID를 `wrangler.toml`에 적습니다: D1 데이터베이스(`DB`), KV 네임스페이스 두 개(`CACHE`, `ASSET_ARCHIVE`), 선택적으로 Analytics Engine 데이터셋(`EVENTS`; 끄려면 `ANALYTICS_ENABLED = "false"`).
2. 도메인을 설정합니다: `wrangler.toml`의 `routes`, `src/site.ts`의 `HOST`, `web/src/lib/site.ts`의 사이트 이름. 이미 DNS 레코드가 있는 호스트명에는 커스텀 도메인을 붙일 수 없으므로 파킹 레코드를 먼저 삭제합니다. 카드 앱은 `play.<도메인>`, 샌드박스 셸은 `c<id>.<도메인>`에서 동작하며 둘 다 같은 와일드카드 라우트로 제공되므로 존에 프록시된 와일드카드 DNS 레코드가 필요합니다.
3. `[vars]`의 `PROVIDER_API_BASE_HARBOR`와 웹 빌드의 `VITE_HARBOR_API_BASE`를 설정합니다. Hearthroom은 HarperHarbor만 연결합니다. LunaTalk과 지역별 게이트웨이는 지원하지 않습니다.
4. 심사 여부를 정합니다: `[vars]`의 `REVIEW_ENABLED = "true"`이면 제출에 커뮤니티 심사가 필요합니다. 다른 값이면 심사 없이 등재됩니다. 심사를 위해 제공자 쪽에 키나 계정을 둘 필요는 없습니다. 심사자는 `node scripts/grant-reviewer.mjs <제공자 계정 ID>`로 부여합니다.
5. 선택적으로 `wrangler secret put SHORTCUT_SECRET`(임의의 무작위 문자열)를 설정합니다. 성인 콘텐츠를 켠 회원이 성인 카드를 홈 화면에 추가할 수 있도록 단기 키에 서명하는 데 쓰입니다. 설정하지 않으면 성인 카드에는 해당 버튼이 나타나지 않습니다.
6. 배포합니다:

```bash
npm run migrate:remote
npm run deploy              # 사전 점검, 타입 검사, 테스트, 빌드를 먼저 실행
```

`.github/workflows/deploy.yml`의 워크플로는 모든 push와 PR에서 타입 검사, 빌드, 테스트를 실행합니다. `main`에서는 저장소 secrets `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`가 설정되어 있으면 마이그레이션 적용과 배포도 수행합니다. 설정되지 않았으면 배포 단계를 건너뛰고 실행은 성공으로 처리됩니다.

## 커뮤니티

토론, 카드 공유, 개발 조율은 [Discord](https://discord.gg/C7m85YPHmK)에서 이루어집니다. 버그 신고와 기능 제안은 [GitHub issue](https://github.com/hearthroom/hearthroom/issues)로 보내 주세요.

## 기여하기

- **Issue** — 버그는 페이지, 브라우저, 기대한 동작을 적어 주세요.
- **Pull Request** — CI는 모든 PR에서 타입 검사, 빌드, 테스트를 실행합니다. PR 하나에 변경 하나, 테스트는 해당 코드 옆에(Worker는 `test/`, web은 `web/test/`), push 전에 `npm test`를 실행하세요.
- **번역** — UI 문자열은 `web/src/locales/<언어>.json`에 언어당 한 파일씩 있습니다. `npm run i18n -w web`이 언어별 누락 키를 보고합니다. 새 문자열은 다섯 파일 모두에 추가해야 하며, 컴포넌트에 미번역 문자열이 있으면 테스트 단계가 실패합니다. 카드 작성 가이드는 `docs/guide/`에 언어별로 한 파일씩 있습니다.
- **채팅 스테이지** — 대화 UI 변경은 스테이지 저장소로 보냅니다. 여기서는 하지 않습니다.
- **라이선스** — 기여는 프로젝트와 같은 AGPL-3.0으로 받습니다.

## 라이선스

[GNU Affero General Public License v3.0](LICENSE). 수정한 버전을 네트워크 서비스로 운영하는 경우, 그 사용자에게 수정된 소스 코드를 제공해야 합니다.
