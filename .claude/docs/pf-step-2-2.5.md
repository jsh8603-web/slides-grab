# Step 2~2.5 — HTML 생성 + 자동화 검증

## Step 2 — 슬라이드 HTML 생성

1. **디자인 모드 선택**: `.claude/docs/design-modes.md`를 읽고, `slide-outline.md` Meta 섹션에 지정된 디자인 모드를 확인하여 적용
2. `.claude/skills/design-skill/SKILL.md` 참조하여 슬라이드 생성
3. 생성 위치: `slides/프레젠테이션명/slide-01.html` ~ `slide-NN.html`
4. **HTML 예방 규칙 확인 필수**: `.claude/rules/html-prevention-rules.md` 읽고 금지/필수 규칙 반영
5. **NanoBanana 이미지 반영**:
   - `assets/` 에 이미지가 있으면 `<img src="assets/slide-{NN}-{slug}.png">` 로 참조
   - 이미지 미준비 시 `<div data-image-placeholder>` 로 영역 확보
6. html2pptx 규칙 준수:
   - `<p>`, `<h1>`~`<h6>`, `<li>`에 background/border 사용 금지 → `<div>` 래핑
   - 720pt × 405pt, 하단 여백 0.5" 이상
   - **`linear-gradient` + 흰색 텍스트 절대 금지** → 단색 배경으로 대체 (패턴 #14)
7. **이미지-텍스트 대비 확인**: 밝은 이미지 옆 텍스트에 text-shadow 또는 반투명 오버레이 적용
8. **카드 텍스트 여유 확보**: 카드 내 한글+숫자 조합 텍스트는 font-size 11pt 이하, 카드 폭 30% 여유
9. **Preflight 검증** (HTML 생성 완료 직후, Step 2.5 전):
   ```bash
   node scripts/preflight-html.js --slides-dir slides/프레젠테이션명
   ```
   - ERROR 또는 오탐 WARN 발견 시: **오탐/정탐 판정** → 오탐이면 PF 탐지 코드 수정, 정탐이면 슬라이드 HTML 수정 + design-skill 생성 규칙 추가
   - WARN은 맥락 판단하여 수정 여부 결정
   - 코드 수정 시 즉시 `progress.md` 검증 항목에 기재 (§E)
   - Preflight 규칙 (PF-01~PF-55 정적 + PF-03,PF-08,PF-18~PF-28 동적)
   - **PF-25 (Hard Floor)**: font-size < 10pt 검출 → ERROR. 모드별 상위 하한도 검출 (Education: 18pt)
   - `--full` 플래그로 Playwright 기반 동적 검사 추가 (~30초 소요)
10. **전수 폰트 감사** (Preflight 통과 후, Step 2.5 전):
   - 전체 슬라이드의 모든 `font-size` 선언을 스캔
   - design-modes.md의 해당 모드 Hard Floor 대비 위반 항목 검출
   - 위반 발견 시: 폰트 축소 대신 슬라이드 분할 또는 텍스트 축약으로 해결
11. 생성 완료 후 자동으로 Step 2.5 진행 (끊기지 않게)

## Step 2.5 — 자동화 검증 + 고해상도 시각 확인 (필수 — 건너뛰기 금지)

HTML 슬라이드 생성 완료 후, **에디터 실행 전에** 프로그래매틱 검증 + COM 300DPI 고해상도 프리뷰로 레이아웃을 검증한다.

### 절차 (4단계 파이프라인)

1. **PPTX 변환** (preflight + 변환 + XML 검증이 통합 실행)
   ```bash
   node scripts/convert-native.mjs --slides-dir slides/프레젠테이션명 --output "slides/프레젠테이션명/프레젠테이션명.pptx"
   ```
   이 명령은 자동으로 3단계를 실행:
   - **Preflight**: HTML 정적 검사 (11개 안티패턴, 밀리초). ERROR 시 중단
   - **변환**: html2pptx 실행 (gradient 자동 fallback + CJK 가중 보정). 빌드타임 대비 경고 출력
   - **XML Validator**: PPTX ZIP 내 XML 파싱 (오버플로/정렬/대비/테이블 빈 셀, ~2초). VP-01~VP-07 정밀 수치 검증
     - **VP-05**: 테이블 빈 셀 감지 (데이터 셀 비어있으면 WARN, 전체 행 비면 ERROR)
     - **VP-06**: 테이블 일관성 (열 수 불일치 ERROR, 데이터 셀 50%+ 비면 ERROR)

2. **자동 검증 결과 확인**:
   - `❌ ERROR` 있으면 → HTML 수정 → 재변환 (최대 2회)
   - `⚠️ WARN` 만 있으면 → 맥락 판단하여 수정 여부 결정

3. **HTML ↔ PPTX 비교 검증** (변환 충실도 확인):
   HTML 원본의 Playwright 스크린샷과 PPTX COM 프리뷰를 나란히 비교하여, 변환 과정에서 시각적 차이가 발생한 슬라이드를 감지한다.

   ```bash
   # 3-a. HTML 스크린샷 생성 (Playwright, 1600×900)
   node scripts/screenshot-html.mjs --slides-dir slides/프레젠테이션명 --output slides/프레젠테이션명/html-preview

   # 3-b. COM 300DPI PPTX 프리뷰 생성 (4000×2250)
   powershell -ExecutionPolicy Bypass -File scripts/export-slides-png.ps1 \
     -PptxPath "slides/프레젠테이션명/프레젠테이션명.pptx" \
     -OutputDir "slides/프레젠테이션명/preview"
   ```

   **비교 절차**: 각 슬라이드에 대해 `html-preview/slide-{NN}.png`와 `preview/slide-{NN}.png`를 `Read`로 열어 나란히 확인:
   - **형태 변형**: 원형→사각형, 그래프 왜곡, CSS 효과 누락 (gradient, shadow, border-radius)
   - **텍스트 잘림/이동**: 오버플로, 줄바꿈 차이, 위치 이동
   - **색상 차이**: 배경/전경 대비, 투명도 손실
   - **이미지 깨짐**: placeholder 표시, 비율 왜곡
   - **테이블/차트**: 데이터 누락, 셀 정렬, 빈 셀
   - **IC (Image in Context)** — 아래 IC-01~IC-04 체크리스트 실행:

   #### IC 검증 체크리스트 (COM 비교 시 이미지 포함 슬라이드에 적용)

   | IC 코드 | 검증 항목 | 판정 기준 | FAIL 시 행동 |
   |---------|----------|----------|-------------|
   | IC-01 | 이미지 로딩 | PPTX 프리뷰에서 이미지 정상 표시 (placeholder/깨짐 없음) | 이미지 경로/포맷 확인 → HTML `<img src>` 수정 |
   | IC-02 | 텍스트-이미지 대비 | 이미지 위/옆 텍스트가 읽을 수 있는지 (WCAG AA: 4.5:1 이상) | HTML에 text-shadow/반투명 오버레이 추가 |
   | IC-03 | 비율/크롭 왜곡 | 원본 비율 vs 컨테이너 비율 차이 ≤10%, 핵심 피사체 잘리지 않음 | 이미지 비율 재생성 또는 컨테이너 비율 조정 |
   | IC-04 | 해상도 열화 | PPTX 300DPI 프리뷰에서 픽셀 깨짐/흐림 없음 (원본 ≥ 1080px 장변) | `--size 2K`로 고해상도 재생성 |

   **IC ERROR/WARN 분류**:
   - IC-01 로딩 실패 → **ERROR** (이미지 없는 슬라이드)
   - IC-02 대비 부족 → **ERROR** (텍스트 불가독)
   - IC-03 비율 왜곡 >10% → **WARN** (미세 왜곡은 허용)
   - IC-04 해상도 열화 → **WARN** (프리젠테이션 환경에서 체감 여부)

   IC 오탐/정탐 판정 + 재검증 → `pf-step-1.5b.md` §IP/IV/IC/VQA 에러 발생 시 참조

   **차이 발견 시**: HTML을 html2pptx 호환 방식으로 수정 (CSS 트릭 → 단순 구조 대체). 수정 후 재변환+재비교 (최대 2회)

   특정 슬라이드만 비교할 때:
   ```bash
   node scripts/screenshot-html.mjs --slides-dir slides/프레젠테이션명 --output slides/프레젠테이션명/html-preview --slides "1,3,5"
   powershell -ExecutionPolicy Bypass -File scripts/export-slides-png.ps1 \
     -PptxPath "slides/프레젠테이션명/프레젠테이션명.pptx" \
     -OutputDir "slides/프레젠테이션명/preview" -Slides "1,3,5"
   ```

4. **VP/COM ERROR 또는 오탐 WARN → 오탐/정탐 판정 + 코드 수정 (필수)**
   PF 검사를 통과해도 VP/COM에서 ERROR 또는 오탐 WARN이 발생할 수 있다 (변환 후에만 드러나는 이슈).
   ERROR 또는 오탐 WARN 발견 시:
   - **오탐** (VP/COM 탐지 로직 문제) → `validate-pptx.js` 또는 COM 비교 로직 수정
   - **정탐** (실제 렌더링 문제) → HTML 원본 수정 + `design-skill/SKILL.md` 또는 `html-prevention-rules.md` 생성 규칙 추가
   - 코드 수정 시 즉시 `progress.md` 검증 항목에 기재 (§E)
   - 재변환 → 재검증 (최대 2회). ERROR는 반드시 수정, WARN은 맥락 판단.

5. **이슈 발견 시**: HTML 수정 → 재변환 → 재검증 (최대 2회)
6. **수정 내용을 `.claude/docs/pptx-inspection-log.md`에 기록** (오탐도 "오탐 수정" 명시)
7. 검증 통과 후 Step 3 진행

### 검증 통과 기준

- **Preflight**: ERROR 0건
- **변환 대비 검사**: `CONTRAST ERROR` 0건
- **XML Validator**: ERROR 0건 (VP-01~VP-16). VP ERROR는 HTML 원본 수정으로 해결 (VP/COM 피드백 루프)
- **COM Validator**: VC-01~VC-07 ERROR 0건. VC ERROR도 HTML 원본 수정 대상
- **HTML↔PPTX 비교**: 형태 변형·텍스트 잘림·색상 차이 없음
- 2회 수정 후에도 해결 불가 이슈는 `pptx-inspection-log.md`에 기록하고 사용자에게 보고

### 적용 범위 (Step 2.5)

이 검증은 **전체 프레젠테이션 워크플로우 외**에서도 적용한다:
- 이미지 재생성 후 HTML 수정 → 재변환 시
- 사용자 요청으로 개별 슬라이드 수정 → 재변환 시
- html2pptx.cjs 코드 수정 후 재변환 시

축약 절차: `convert-native.mjs` 재실행만으로 preflight+변환+XML검증 전부 수행. COM Export는 변경 슬라이드만 (`-Slides` 파라미터)

### Step 2.5 → Step 3 게이트 (필수 — 컨텍스트 압축 후에도 유지)

**Step 2.5 HTML↔PPTX 비교 검증을 완료하기 전에 Step 3 에디터/다운로드 링크를 사용자에게 제공하는 것은 금지.**
비교 검증에서 텍스트 줄바꿈·형태 변형·색상 차이가 발견되면 수정→재변환→재비교 완료 후에만 링크 제공.

**컨텍스트 압축 후 재개 시**: progress.md에 "Step 2.5 COM 비교 통과" 기록이 없으면, 대화 요약에 "변환 성공"이라고 되어 있어도 Step 2.5를 재실행해야 한다. 변환 성공 ≠ COM 비교 통과.

**게이트 통과 시 필수 행동**:
1. `progress.md`에 "Step 2.5 COM 비교 검증 통과" 기록
2. `pptx-inspection-log.md`에 수정 내용 기록 (수정이 있었으면)
3. 그 후에만 Step 3 진행
