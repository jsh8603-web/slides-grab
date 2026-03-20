# Step 0~1.5A — 소스 확인, 아웃라인, 초안

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
- 3번 선택 → `node scripts/nlm-auto-research.js --topic "주제"` 실행 (기본값 `--mode auto`, `.claude/docs/notebooklm-fetch.md` 참조)
- 4번 선택 → `.claude/docs/notebooklm-fetch.md` 절차로 내용 추출
- 5번 선택 → WebFetch/Read로 내용 수집
- 6번 선택 → WebSearch로 조사 후 진행

## Step 1 — 폴더 생성 + 아웃라인 작성

1. `slides/프레젠테이션-영문-슬러그/` 폴더 생성 (예: `slides/tax-efficient-jv-guide/`)
   - **폴더는 Step 0 완료 직후, Step 1 시작 시 즉시 생성** (NLM 출력 경로 등에서 ENOENT 방지)
   - `mkdir -p slides/프레젠테이션명` 실행 후 다음 작업 진행
2. **progress.md 초기화** — 폴더 생성 즉시 `slides/프레젠테이션명/progress.md` 생성:
   - `## 활성 규칙` 섹션에 `production-reporting-rules.md`, `html-prevention-rules.md`, `nanoBanana-guide.md` 체크박스 추가
   - 세션 복원 시 이 섹션의 미완료 항목 파일을 Read로 재로드
   - `production-reporting-rules.md`를 이 시점에 **1회만** Read (이후 Step에서 재로드 금지)
3. 소스 자료 기반으로 `slide-outline.md` 작성 (프로젝트 루트에)
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

초안은 Marp가 이미지 기반으로 렌더링하므로 PPTX 내 텍스트 편집 불가. 구성/분량 확인 전용.
외부 다운로드를 위해 에디터 서버를 파일 서빙용으로 실행한다 (에디터 UI는 사용하지 않음).

```bash
# 기존 에디터 종료 후 파일 서빙용 서버 실행
netstat -ano | grep "LISTENING" | grep -E ":(3456|3457|3458|3459|3460)" | awk '{print $5}' | while read pid; do taskkill //PID $pid //F 2>/dev/null; done
GEMINI_API_KEY=$GEMINI_API_KEY node scripts/editor-server.js --slides-dir slides/프레젠테이션명 --port 3456 --tunnel &
```

서버 로그에서 `Tunnel:` URL을 읽어 안내:

```
빠른 초안이 생성됐습니다! (구성/분량 확인용 — 이미지 기반, 텍스트 편집 불가)

다운로드: {터널URL}/output/draft.pptx

구성과 분량을 확인하고 알려주세요:
- 이대로 진행 → 디자인 슬라이드 제작 시작
- 수정 필요 → 대화로 수정 지시 (예: "슬라이드 3 삭제", "5번과 6번 순서 교체")

※ Marp 초안은 PPT 내 직접 편집이 불가합니다. 수정은 대화로 알려주시면 아웃라인 수정 후 초안을 재생성합니다.
```

데스크톱 세션에서는 `--open` 플래그로 PPTX 자동 열기도 병행.

### 수정 피드백 형식

사용자가 수정을 요청하면, AI가 아웃라인을 수정하고 draft를 재생성한다. 수정 전 번호 리스트로 정리 후 확인:

```
수정 내용:
1. 슬라이드 3: 제목 "XXX" → "YYY" 변경
2. 슬라이드 5~6: 순서 교체
3. 슬라이드 8: 삭제

진행할까요?
```

재생성 후 같은 URL(`/output/draft.pptx`)에서 갱신된 파일을 다시 다운로드할 수 있다.

### 초안 확인 후 분기

- **이대로 진행** → Step 1.5B (NanoBanana 이미지 생성) + Step 2 (HTML 슬라이드)
- **수정 필요** → 아웃라인 수정 → 초안 재생성 (이 단계 반복)

**NanoBanana 이미지 생성은 초안 확인과 병렬 실행 가능** — 초안 확인을 기다리는 동안 이미지 생성을 먼저 시작해도 된다. 단, 아웃라인 구조가 변경되면 이미지를 재생성해야 하므로 대규모 수정이 예상되면 이미지 생성을 대기한다.
