# NotebookLM 콘텐츠 추출

NotebookLM 노트북 URL이 제공되면 이 절차로 소스 내용을 추출한다.

## 방법: Playwright 영구 세션

Google 로그인이 필요하므로 headful 브라우저 + 영구 세션 디렉토리를 사용한다.

```bash
node scripts/fetch-notebooklm.js <노트북-URL> [출력파일]
```

### 동작 방식
1. `.playwright-session/` 디렉토리에 브라우저 세션 유지
2. 첫 실행 시 Google 로그인 화면이 뜸 → 사용자가 직접 로그인
3. 로그인 후 자동으로 노트북 내용 추출 → `notebook-content.md`로 저장
4. 이후 실행부터는 세션이 유지되어 자동 접근

### 사용자 안내 (첫 실행 시)

```
NotebookLM에 접근하려면 Google 로그인이 필요합니다.
지금 브라우저 창이 열리면서 Google 로그인 화면이 나타납니다.

로그인을 완료하시면 자동으로 내용을 가져옵니다.
(한 번만 로그인하면 다음부터는 자동으로 접근됩니다)
```

### 추출 내용
- 노트북 제목
- 소스 목록 (Source 패널)
- 노트 (Notes 패널)
- 메인 콘텐츠 영역

### 제한사항
- WebFetch로는 접근 불가 (Google 인증 302 리다이렉트)
- headless 모드 불가 (Google이 자동화 감지 차단)
- `.playwright-session/`은 .gitignore에 포함 필수

## 자동 수집 모드 (주제 기반)

주제만 입력하면 NotebookLM이 웹에서 자동으로 자료를 수집한다.

```bash
node scripts/nlm-auto-research.js --topic "주제" [--output 출력파일] [--timeout 초] [--mode fast|deep|auto]
```

### 동작 방식
1. `.playwright-session/` 디렉토리에 브라우저 세션 유지 (기존 fetch와 공유)
2. **주제 난이도 자동 판정** (`auto` 모드) → Fast Research 또는 Deep Research 선택
3. NotebookLM 접속 → 새 노트북 생성
4. 웹 연구 기능 트리거 → 주제 입력 → 모드에 따라 Deep Research 토글 전환
5. 연구 완료 대기 (Fast: 120초, Deep: 300초 기본)
6. 완료 후 소스/노트/콘텐츠 자동 추출 → `notebook-content.md` 저장

### Research Mode (자동 난이도 판정)

`--mode auto` (기본값)일 때 주제를 분석하여 자동으로 모드를 선택한다.

| 판정 | Deep 전환 기준 | 예시 |
|------|---------------|------|
| **키워드** | 분석, 비교분석, 논문, 연구, 학술, 심층, comprehensive, in-depth | "한국 교육제도 변천사 분석" |
| **길이** | 한글 30자+ / 영문 60자+ | 긴 쿼리는 복합적 주제일 가능성 |
| **비교 구문** | vs, 비교, 장단점, versus | "React vs Vue 성능 비교분석" |
| **Fast 유지** | 어린이, 초등, 소개, 개요, 간단, fun facts | "태양계 행성 어린이 소개" |

Deep Research는 Fast보다 더 많은 소스를 수집하고 깊은 분석을 수행하지만, 시간이 더 오래 걸린다 (2~5분).

### 사용자 안내 (첫 실행 시)

기존 fetch와 동일 — Google 로그인 필요 시 브라우저에서 수동 로그인.

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--topic` | (필수) | 연구 주제 |
| `--output` | `notebook-content.md` | 출력 파일 경로 |
| `--timeout` | auto (fast:120, deep:300) | 연구 완료 대기 최대 시간 (초) |
| `--mode` | `auto` | `fast`: 빠른 연구, `deep`: 심층 연구, `auto`: 주제 난이도로 자동 판정 |

### 디버깅 방법

NLM UI가 변경되어 셀렉터가 작동하지 않을 때:
1. `headless: false` (기본값)로 실행하여 브라우저를 직접 관찰
2. 스크립트가 각 단계에서 디버그 스크린샷 자동 저장 (`nlm-debug-*.png`)
3. CDK 오버레이 이슈 시 3단계 전략 자동 시도:
   - Strategy 1: `fill({ force: true })` — Playwright 강제 입력
   - Strategy 2: DOM 직접 조작 (`nativeInputValueSetter` + Angular 이벤트)
   - Strategy 3: `dispatchEvent(click)` + `keyboard.type` 조합
4. 실패 시 스크린샷으로 현재 UI 상태 확인 후 셀렉터 업데이트

### 제한사항
- NotebookLM UI 변경 시 셀렉터 업데이트 필요
- headless 모드 불가 (Google 자동화 감지)
- 첫 실행 시 수동 Google 로그인 필수

## 추출 후 흐름

notebook-content.md 저장 후 → 내용 분석 → slide-outline.md 작성 → 사용자 승인 대기
