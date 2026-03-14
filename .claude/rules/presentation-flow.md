# 프레젠테이션 제작 워크플로우

사용자가 프레젠테이션 관련 요청을 하면 이 흐름을 따른다.
**목표: 비전문가도 끊김 없이 완성품까지 도달하도록 안내**

## 트리거 감지

| 사용자 발화 | 시작 지점 |
|------------|----------|
| "~~ 주제로 만들어줘" / "프레젠테이션 만들어줘" | Step 0 (소스 확인) |
| "아웃라인 검토해줘" / outline 파일 제공 | Step 2 (폴더 생성 → 아웃라인 리뷰) |
| "슬라이드 수정해줘" | Step 3 (비주얼 에디터 실행) |
| "pptx 변환" / "pdf 변환" / "내보내기" | Step 5 (출력 형식 선택) |

## Step 0 — 소스 확인 (필수 — 건너뛰기 금지)

프레젠테이션 주제가 주어지면, **반드시** 소스 자료를 어떻게 확보할지 선택형으로 질문한다.
일반 지식 주제라도 임의로 판단하여 자동 진행 금지. **사용자가 번호로 응답할 때까지 다음 단계 진행 금지.**

```
소스 자료를 어떻게 준비할까요?

1. NotebookLM Fast Research (빠른 웹 조사, ~2분)
2. NotebookLM Deep Research (심층 웹 조사, ~5분)
3. NotebookLM 자동 판단 (주제 난이도로 fast/deep 자동 선택)
4. NotebookLM 노트북 링크 제공 (이미 만든 노트북이 있을 때)
5. URL 또는 파일 직접 제공 (웹페이지, PDF, 문서 등)
6. AI가 알아서 조사 (일반적인 주제일 때)
```

- 1번 선택 → `node scripts/nlm-auto-research.js --topic "주제" --mode fast` 실행
- 2번 선택 → `node scripts/nlm-auto-research.js --topic "주제" --mode deep` 실행
- 3번 선택 → `node scripts/nlm-auto-research.js --topic "주제"` 실행 (기본값 `--mode auto`, `.claude/rules/notebooklm-fetch.md` 참조)
- 4번 선택 → `.claude/rules/notebooklm-fetch.md` 절차로 내용 추출
- 5번 선택 → WebFetch/Read로 내용 수집
- 6번 선택 → WebSearch로 조사 후 진행

## Step 1 — 폴더 생성 + 아웃라인 작성

1. `slides/프레젠테이션-영문-슬러그/` 폴더 생성 (예: `slides/tax-efficient-jv-guide/`)
2. 소스 자료 기반으로 `slide-outline.md` 작성 (프로젝트 루트에)
3. `.claude/skills/plan-skill/SKILL.md` 참조하여 아웃라인 구성
4. **NanoBanana 이미지 태그 포함**: 이미지가 필요한 슬라이드에 `NanoBanana:` 태그 작성
   - 태그 작성 규칙 → `plan-skill/SKILL.md` NanoBanana 이미지 태그 섹션 참조
   - **비율 힌트는 예상값**: Step 1 시점의 비율(`[3:4]`, `[4:3]` 등)은 레이아웃 설계 의도 기반. Step 1.5A 초안 확인 후 실제 레이아웃이 변경되면 비율 힌트도 업데이트
5. 아웃라인을 사용자에게 보여주고 승인 요청

**승인 전까지 슬라이드 생성 금지**

## Step 1.5A — 빠른 초안 확인 (필수 — 건너뛰기 금지)

아웃라인 승인 직후, **반드시** Marp 초안을 생성하여 구성/분량을 사용자에게 확인받는다.
이 단계를 건너뛰고 바로 HTML 슬라이드 생성으로 넘어가지 않는다.

### 실행

```bash
node scripts/draft-marp.mjs --outline slide-outline.md --output slides/프레젠테이션명/draft.pptx --open
```

### 사용자 안내

```
빠른 초안이 생성됐습니다! (텍스트만 — 30초 소요)

파일 위치: slides/프레젠테이션명/draft.pptx
(자동으로 열립니다. 안 열리면 파일을 더블클릭하세요)

구성과 분량을 확인하고 알려주세요:
- 이대로 진행 → NanoBanana 이미지 + 디자인 슬라이드 제작 시작
- 수정 필요 → 아웃라인을 수정한 뒤 초안 재생성
```

### 초안 확인 후 분기

- **이대로 진행** → Step 1.5B (NanoBanana 이미지 생성) + Step 2 (HTML 슬라이드)
- **수정 필요** → 아웃라인 수정 → 초안 재생성 (이 단계 반복)

**NanoBanana 이미지 생성은 초안 확인과 병렬 실행 가능** — 초안 확인을 기다리는 동안 이미지 생성을 먼저 시작해도 된다. 단, 아웃라인 구조가 변경되면 이미지를 재생성해야 하므로 대규모 수정이 예상되면 이미지 생성을 대기한다.

## Step 1.5B — NanoBanana 이미지 자동 생성

아웃라인 승인 + 초안 확인 후, `generate-images.mjs` 스크립트로 Gemini API를 호출하여 이미지를 자동 생성한다.

### 전제 조건

`GEMINI_API_KEY` 환경변수가 설정되어 있어야 한다. 미설정 시 사용자에게 안내:
```
Gemini API 키가 필요합니다. https://aistudio.google.com/apikey 에서 발급 후:
export GEMINI_API_KEY=your-api-key
```

### 실행

```bash
# 기본 (병렬 2개, Sharp 후처리 포함)
node scripts/generate-images.mjs \
  --outline slide-outline.md \
  --output slides/프레젠테이션명/assets

# 체인 모드 권장 (첫 이미지를 참조로 덱 일관성 유지)
node scripts/generate-images.mjs \
  --outline slide-outline.md \
  --output slides/프레젠테이션명/assets \
  --chain
```

### 주요 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--model` | `gemini-2.0-flash-exp` | 모델 ID |
| `--size` | `2K` | 해상도 (대문자 K 필수) |
| `--concurrency` | `2` | 동시 호출 수 (IPM 제한 고려) |
| `--chain` | false | 첫 이미지를 참조로 나머지 순차 생성 (덱 일관성) |
| `--force` | false | 기존 이미지 전부 덮어쓰기 |
| `--regenerate` | - | 특정 슬라이드만 재생성 (예: `--regenerate 3,5,8`) |
| `--optimize` / `--no-optimize` | true | Sharp 후처리 (1920×1080 리사이즈 + 압축) |
| `--dry` | false | 프롬프트만 확인 (API 호출 없음) |

### 이미지-텍스트 대비 규칙

텍스트와 병렬 배치되는 이미지(grid 50:50, 반쪽 레이아웃)의 NanoBanana 프롬프트에 반드시 밝기 제한 키워드를 포함한다:
- **어두운 배경 슬라이드**: `"dark moody atmosphere, low-key lighting, deep shadows"` 추가
- **밝은 배경 슬라이드**: `"muted, desaturated tones, soft diffused light"` 추가
- **전체 배경 이미지**: `"muted, subtle, desaturated"` (기존 nanoBanana-guide.md 규칙 9번)

### 자동 처리 기능

- **Meta 스타일 앵커**: outline의 Color Palette + Tone/Mood를 모든 프롬프트에 자동 prepend
- **비율 힌트**: 프롬프트 내 `[3:4]`, `[4:3]`, `[1:1]` 등 비율 힌트를 파싱하여 이미지별 개별 비율 적용. 레이아웃 기반 비율 결정 규칙은 `nanoBanana-guide.md` "이미지 비율 결정 규칙" 섹션 참조. 분할 레이아웃에 16:9 사용 금지
- **복수 태그**: 동일 슬라이드에 여러 `NanoBanana:` 태그 가능 (파일명 자동 접미사: `-b`, `-c`)
- **Rate Limit**: 429 에러 시 지수 백오프 자동 재시도 (최대 5회)
- **Safety Filter**: 차단 사유별 한글 안내 자동 출력
- **Sharp 후처리**: 비율별 해상도로 리사이즈 + 압축 (16:9→1920×1080, 3:4→1080×1440, 4:3→1440×1080, 1:1→1080×1080 등). 미등록 비율은 경고 출력 + 원본 유지
- **해상도 로그**: 각 이미지 생성 완료 시 `{width}×{height} ({ratio})` 자동 출력 → 비율 힌트와 실제 해상도 불일치 시 dimensions 맵 확인

### 실패 시

- 개별 이미지 실패는 나머지에 영향 없음 (계속 진행)
- 실패한 슬라이드는 Step 2에서 placeholder로 처리
- 스크립트가 실패 슬라이드 재생성 명령어를 자동 출력

**이미지 전부 미준비 시**: `--dry`로 태그 확인만 하고 placeholder로 진행 가능

## Step 2 — 슬라이드 HTML 생성

1. `.claude/skills/design-skill/SKILL.md` 참조하여 슬라이드 생성
2. 생성 위치: `slides/프레젠테이션명/slide-01.html` ~ `slide-NN.html`
3. **HTML 예방 규칙 확인 필수**: `.claude/rules/html-prevention-rules.md` 읽고 금지/필수 규칙 반영
4. **NanoBanana 이미지 반영**:
   - `assets/` 에 이미지가 있으면 `<img src="assets/slide-{NN}-{slug}.png">` 로 참조
   - 이미지 미준비 시 `<div data-image-placeholder>` 로 영역 확보
5. html2pptx 규칙 준수:
   - `<p>`, `<h1>`~`<h6>`, `<li>`에 background/border 사용 금지 → `<div>` 래핑
   - 720pt × 405pt, 하단 여백 0.5" 이상
   - **`linear-gradient` + 흰색 텍스트 절대 금지** → 단색 배경으로 대체 (패턴 #14)
6. **이미지-텍스트 대비 확인**: 밝은 이미지 옆 텍스트에 text-shadow 또는 반투명 오버레이 적용
7. **카드 텍스트 여유 확보**: 카드 내 한글+숫자 조합 텍스트는 font-size 11pt 이하, 카드 폭 30% 여유
8. **Preflight 검증** (HTML 생성 완료 직후, Step 2.5 전):
   ```bash
   node scripts/preflight-html.js --slides-dir slides/프레젠테이션명
   ```
   - ERROR 발견 시 자동 수정 → 재검증. 사용자 질문 없이 처리
   - WARN은 맥락 판단하여 수정 여부 결정
   - Preflight는 9개 안티패턴을 밀리초 단위로 정적 검사 (PF-01~PF-08)
   - `--full` 플래그로 Playwright 기반 심층 검사도 가능 (오버플로, CJK 폰트 크기)
9. 생성 완료 후 자동으로 Step 2.5 진행 (끊기지 않게)

## Step 2.5 — 자동화 검증 + MCP 시각 확인 (필수 — 건너뛰기 금지)

HTML 슬라이드 생성 완료 후, **에디터 실행 전에** 프로그래매틱 검증 + 필요시 MCP 프리뷰로 레이아웃을 검증한다.

### 절차 (3단계 파이프라인)

1. **PPTX 변환** (preflight + 변환 + XML 검증이 통합 실행)
   ```bash
   node scripts/convert-native.mjs --slides-dir slides/프레젠테이션명 --output "slides/프레젠테이션명/프레젠테이션명.pptx"
   ```
   이 명령은 자동으로 3단계를 실행:
   - **Preflight**: HTML 정적 검사 (9개 안티패턴, 밀리초). ERROR 시 중단
   - **변환**: html2pptx 실행 (gradient 자동 fallback + CJK 가중 보정). 빌드타임 대비 경고 출력
   - **XML Validator**: PPTX ZIP 내 XML 파싱 (오버플로/정렬/대비, ~2초). 정밀 수치 검증

2. **자동 검증 결과 확인**:
   - `❌ ERROR` 있으면 → HTML 수정 → 재변환 (최대 2회)
   - `⚠️ WARN` 만 있으면 → 맥락 판단하여 수정 여부 결정
   - 모든 체크 통과 시 → MCP 프리뷰 생략 가능 (시각 품질에 의심 없으면)

3. **MCP 프리뷰 (시각 품질 확인)** — 다음 경우에만 실행:
   - XML validator가 경고를 플래그한 슬라이드 (해당 슬라이드만)
   - 이미지-텍스트 대비가 우려되는 슬라이드 (밝은 이미지 + 어두운 텍스트)
   - 새로운 레이아웃 패턴을 처음 사용한 경우
   ```
   ppt_open_presentation → file_path, read_only=true
   ppt_activate_presentation → presentation_index
   ppt_get_slide_preview → 플래그된 슬라이드만
   ppt_close_presentation → save_changes=false
   ```

4. **이슈 발견 시**: HTML 수정 → 재변환 → 재검증 (최대 2회)
5. **수정 내용을 `.claude/rules/pptx-inspection-log.md`에 기록**
6. 검증 통과 후 Step 3 진행

### 검증 통과 기준

- **Preflight**: ERROR 0건
- **변환 대비 검사**: `CONTRAST ERROR` 0건
- **XML Validator**: overflow/alignment ERROR 0건
- MCP 프리뷰에서 시각적 이상 없음 (실행한 경우)
- 2회 수정 후에도 해결 불가 이슈는 `pptx-inspection-log.md`에 기록하고 사용자에게 보고

### 적용 범위 (Step 2.5)

이 검증은 **전체 프레젠테이션 워크플로우 외**에서도 적용한다:
- 이미지 재생성 후 HTML 수정 → 재변환 시
- 사용자 요청으로 개별 슬라이드 수정 → 재변환 시
- html2pptx.cjs 코드 수정 후 재변환 시

축약 절차: `convert-native.mjs` 재실행만으로 preflight+변환+XML검증 전부 수행. MCP는 변경 슬라이드만

## Step 3 — 비주얼 에디터 실행

슬라이드 생성 완료 후 비주얼 에디터를 실행한다 (viewer.html 미리보기 대신).

### 포트 충돌 처리

기본 포트(3456)에 이미 다른 프레젠테이션 에디터가 실행 중일 수 있다.
실행 전 포트 사용 여부를 확인하고, 충돌 시 다음 포트(3457, 3458, ...)로 자동 전환한다.

```bash
# 1. 기본 포트 확인
curl -s http://localhost:3456/ > /dev/null 2>&1

# 2-a. 포트 비어있으면 기본 포트 사용 (GEMINI_API_KEY 필수 전달)
GEMINI_API_KEY=$GEMINI_API_KEY npx slides-grab edit --slides-dir slides/프레젠테이션명

# 2-b. 포트 사용 중이면 다음 포트로 실행
GEMINI_API_KEY=$GEMINI_API_KEY npx slides-grab edit --slides-dir slides/프레젠테이션명 --port 3457
```

### 안내 메시지

실행 후 사용자에게 실제 할당된 포트 번호로 안내:

```
슬라이드가 완성됐습니다! 비주얼 에디터를 열었습니다.

브라우저에서 http://localhost:{포트}/ 으로 접속하세요.
(자동으로 열리지 않으면 위 주소를 브라우저 주소창에 복사-붙여넣기)

에디터에서 슬라이드를 클릭하면 직접 텍스트를 수정할 수 있고,
영역을 드래그하면 AI에게 해당 부분 수정을 요청할 수 있습니다.

수정이 끝나면 알려주세요!
```

에디터 서버는 `run_in_background=true`로 실행하여 대화가 계속 가능하도록 한다.

## Step 4 — 수정 반복

사용자 피드백에 따라 슬라이드 수정. 에디터가 실행 중이면 브라우저에서 바로 반영됨.

### 레이아웃 이슈 수정 시 — PPT MCP 검증 필수

사용자가 레이아웃 관련 수정을 요청하면 (오버플로, 텍스트 잘림, 요소 겹침, 가독성 등):
1. HTML 수정 적용
2. PPTX 재변환: `node scripts/convert-native.mjs --slides-dir ... --output ...`
3. PPT MCP로 해당 슬라이드 프리뷰 확인: `ppt_open_presentation` → `ppt_get_slide_preview` → 수정 효과 검증
4. 이슈 미해결 시 추가 수정 → 재변환 → 재확인 (최대 2회)
5. `ppt_close_presentation → save_changes=false`
6. 수정 내용을 `.claude/rules/pptx-inspection-log.md`에 기록

### 오류 관련 수정 시 — 검사 기록 필수

사용자 요청으로 수정한 내용이라도 **레이아웃 오류와 관련된 수정이면** `.claude/rules/pptx-inspection-log.md`에 기록한다.
기록 대상: 오버플로, 텍스트 잘림, 요소 겹침, 하단 넘침, 가독성 저하 등 렌더링 품질 이슈.
기록 제외: 텍스트 내용 변경, 색상 취향 변경, 슬라이드 순서 변경 등 디자인 선호 이슈.

- 기존 패턴과 동일하면 발생 사례 테이블에 행 추가
- 새로운 패턴이면 새 섹션 생성 (증상/영향 범위/수정/예방 규칙 포함)

이 기록은 `html-prevention-rules.md` 업데이트의 근거가 된다. 새 패턴 등록 후 예방 규칙도 함께 갱신한다.

"없어" / "완료" / "괜찮아" 등 수정 없음 의사 표현 시:
1. **에디터 서버 종료** (필수): 에디터 포트의 프로세스를 종료한다.
   ```bash
   # Windows
   netstat -ano | grep "LISTENING" | grep ":{포트}" → PID 확인 → taskkill //PID {pid} //F
   # Unix
   lsof -ti :{포트} | xargs kill
   ```
2. **Step 5 선택형 질문**을 한다.

**절대 Step 5를 건너뛰고 변환을 시작하지 않는다.** 사용자가 명시적으로 형식을 선택할 때까지 대기.
**에디터 서버를 종료하지 않고 다음 단계로 넘어가지 않는다.** 포트 누적을 방지.

## Step 5 — 출력 형식 선택 (필수 — 건너뛰기 금지)

### 에디터 자동 종료 (Step 5 진입 시)

Step 5에 진입하면 **먼저** 에디터 서버가 실행 중인지 확인하고, 실행 중이면 종료한다:
```bash
# Windows — 포트 3456~3460 범위 확인
netstat -ano | grep "LISTENING" | grep -E ":(3456|3457|3458|3459|3460)" | awk '{print $5}' | while read pid; do taskkill //PID $pid //F 2>/dev/null; done
```
Step 4에서 이미 종료했더라도 이중 확인. 포트 누적 방지.

수정 완료 후 **반드시** 아래 번호 선택형으로 질문한다. 임의로 형식을 결정하거나 자동 진행 금지.

```
어떤 형식으로 내보낼까요?

1. PPTX (편집 가능한 파워포인트)
2. PDF (인쇄/공유용)
3. 둘 다
```

- 1번 / 3번 선택 → Step 6 (PPTX 생성) 진행
- 2번 선택 → Step 7 (PDF 생성) 진행
- 3번 선택 → Step 6 → Step 7 순서로 진행
- **사용자가 번호로 응답할 때까지 다음 단계 진행 금지**

## Step 6 — PPTX 생성 Phase

### 6-1. 예방 규칙 확인 (필수)

PPTX 변환 전 `.claude/rules/html-prevention-rules.md` 읽기.
금지/필수 규칙이 현재 슬라이드에 반영되었는지 확인하고, 미반영 시 HTML 선제 수정.
디버깅/신규 패턴 참조 시에만 `.claude/rules/pptx-inspection-log.md` 참조.

### 6-2. 변환 실행

```bash
node scripts/convert-native.mjs --slides-dir slides/프레젠테이션명 --output "slides/프레젠테이션명/프레젠테이션명.pptx"
```

#### 변환 에러 발생 시 — 자동 수정 + 기록 (필수)

변환 시 FAILED 슬라이드가 있으면:
1. 에러 메시지 분석 → HTML 수정 (gradient 오버레이, 오버플로, 경로 등)
2. 재변환 (최대 3회)
3. **수정 내용을 `.claude/rules/pptx-inspection-log.md`에 기록** (이슈 패턴 섹션에 추가)
   - 기존 패턴과 동일하면 발생 사례 테이블에 행 추가
   - 새로운 패턴이면 새 섹션 생성 (증상/영향 범위/수정/예방 규칙 포함)
4. html2pptx.cjs 자체 수정이 필요한 경우도 기록

**변환 에러 수정도 검사 Phase 수정과 동일하게 기록한다.** 새 패턴 등록 시 `html-prevention-rules.md`도 함께 갱신하여 Step 2(HTML 생성)와 Step 6-1(예방 규칙 확인)에서 참조되도록 한다.

### 6-3. 검사 Phase (자동 진행, 사용자 대기 없음)

`convert-native.mjs`가 변환 시 자동으로 preflight + XML validation을 실행한다. 이 결과를 기반으로 검사.

#### 검사 절차

0. **폰트 설치 확인** (PPTX 열기 전, 프레젠테이션당 1회)
   ```bash
   powershell -Command "Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts' -ErrorAction SilentlyContinue | Out-String" | grep -i pretendard
   ```
   미설치 시 자동 설치:
   ```bash
   curl -sL "https://github.com/orioncactus/pretendard/releases/download/v1.3.9/Pretendard-1.3.9.zip" -o /tmp/pretendard.zip
   cd /tmp && mkdir -p pretendard && cd pretendard && unzip -o ../pretendard.zip > /dev/null 2>&1
   cat > /tmp/install-fonts.ps1 << 'PSEOF'
   $fontDir = "C:\Users\$env:USERNAME\AppData\Local\Temp\pretendard\public\static"
   $fonts = Get-ChildItem "$fontDir\Pretendard-*.otf"
   $shell = New-Object -ComObject Shell.Application
   $fontsFolder = $shell.Namespace(0x14)
   foreach ($font in $fonts) { $fontsFolder.CopyHere($font.FullName, 0x10) }
   PSEOF
   powershell -ExecutionPolicy Bypass -File /tmp/install-fonts.ps1
   ```

1. **프로그래매틱 검증 결과 확인** — `convert-native.mjs` 출력에서:
   - Preflight ERROR/WARN 확인 (Step 6-2에서 이미 실행됨)
   - 빌드타임 CONTRAST ERROR/WARN 확인
   - XML Validator ERROR/WARN 확인 (오버플로, 정렬, 대비, 빈 텍스트)
   - 구조적 검사는 XML validator가 담당 — MCP `ppt_list_shapes` 좌표 비교 불필요

2. **MCP 시각 품질 확인** — 다음 경우에만 실행:
   - XML validator가 WARN/ERROR를 플래그한 슬라이드
   - 이미지-텍스트 대비가 우려되는 슬라이드
   - 새로운 레이아웃 패턴을 처음 사용한 경우
   ```
   ppt_open_presentation → file_path, read_only=true
   ppt_activate_presentation → presentation_index
   ppt_get_slide_preview → 플래그된 슬라이드만
   ```
   확인 항목 (시각적 심미성 중심):
   - 이모지/특수문자 렌더링 (□ 깨짐)
   - 이미지-텍스트 대비 가독성
   - 전체적인 레이아웃 느낌
   - 폰트 렌더링 품질

3. **이슈 확정 시 자동 수정**
   - `ppt_close_presentation` → HTML 수정 → 재변환 → 재검사 (최대 2회)
   - 수정 내용을 `.claude/rules/pptx-inspection-log.md`에 기록

4. **검사 기록 업데이트**
   - 발견된 이슈와 수정 내용을 로그에 추가
   - 검사 통과 시에도 "통과" 기록 남기기

5. **닫기 + 안내**
   ```
   ppt_close_presentation → save_changes=false
   ```
   ```
   PPTX 파일 검사가 완료됐습니다!

   파일 위치: slides/프레젠테이션명/프레젠테이션명.pptx

   이 파일을 더블클릭하면 PowerPoint에서 열립니다.
   텍스트, 도형, 색상 등을 자유롭게 수정할 수 있습니다.
   ```

## Step 7 — PDF 생성

```bash
slides-grab pdf --slides-dir slides/프레젠테이션명 --output "slides/프레젠테이션명/프레젠테이션명.pdf"
```

변환 완료 후 안내:
```
PDF 파일이 만들어졌습니다!

파일 위치: slides/프레젠테이션명/프레젠테이션명.pdf
```

## 에러 발생 시 안내

### PPTX 변환 실패 (overflow)
슬라이드 내용이 영역을 벗어나면 변환 실패 → 해당 슬라이드 padding/gap 줄여 재시도.

### 검사 Phase 실패 (2회 반복 후에도 이슈)
수정 불가 이슈를 `pptx-inspection-log.md`에 기록하고, 사용자에게 해당 슬라이드와 이슈를 보고.

### NotebookLM 접근 실패
세션 만료 시 `.playwright-session/` 삭제 후 재실행하면 다시 로그인 화면 표시.

### 뷰어가 안 열림
viewer.html은 file:// 프로토콜로 동작. 브라우저에서 직접 파일을 열면 됨.
"연결 프로그램" 팝업 → Chrome/Edge 선택 안내.

## 흐름 원칙

- **자동 진행**: 각 단계 완료 후 다음 단계 안내를 자연스럽게 이어간다
- **선택지 제공**: 막히는 지점에서는 번호 선택형으로 안내
- **파일 경로 명시**: 항상 전체 경로를 알려주어 바로 더블클릭 가능하게
- **전문 용어 최소화**: "빌드", "변환" 등은 풀어서 설명
- **검사 기록 순환**: 생성 → 검사 → 기록 → 다음 생성 시 참조 (피드백 루프)
- **완료 후 다음 제안**: "다른 형식도 필요하시면" / "다른 주제 프레젠테이션도 만들 수 있어요"
