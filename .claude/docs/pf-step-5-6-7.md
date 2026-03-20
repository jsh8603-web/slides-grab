# Step 5~7 — 출력 형식 선택 + PPTX/PDF 생성

## Step 5 — 출력 형식 선택 (필수 — 건너뛰기 금지)

### 에디터 종료 시점

에디터 서버는 Step 6/7 산출물 생성이 완료된 후 종료한다 (외부 `/output` 다운로드 지원을 위해).
Step 5에서는 종료하지 않는다.
```bash
# Step 6/7 완료 후 종료 — Windows, 포트 3456~3460 범위
netstat -ano | grep "LISTENING" | grep -E ":(3456|3457|3458|3459|3460)" | awk '{print $5}' | while read pid; do taskkill //PID $pid //F 2>/dev/null; done
```

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
디버깅/신규 패턴 참조 시에만 `.claude/docs/pptx-inspection-log.md` 참조.

### 6-2. 변환 실행

```bash
node scripts/convert-native.mjs --slides-dir slides/프레젠테이션명 --output "slides/프레젠테이션명/프레젠테이션명.pptx"
```

#### 변환 에러 발생 시 — 자동 수정 + 기록 (필수)

변환 시 FAILED 슬라이드가 있으면:
1. 에러 메시지 분석 → HTML 수정 (gradient 오버레이, 오버플로, 경로 등)
2. 재변환 (최대 3회)
3. **수정 내용을 `.claude/docs/pptx-inspection-log.md`에 기록** (이슈 패턴 섹션에 추가)
4. html2pptx.cjs 자체 수정이 필요한 경우도 기록

**변환 에러 수정도 검사 Phase 수정과 동일하게 기록한다.** 새 패턴 등록 시 `html-prevention-rules.md`도 함께 갱신.

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
   - `Preflight found N ERROR(s)` / `Preflight found N warning(s)` 확인 (PF-01~PF-11)
   - `N contrast issue(s) found` 확인: `[file] <tag> "text": color on bg (ratio:1) ERROR/WARN`
   - `Post-validation found N ERROR(s)` / `Post-validation found N warning(s)` 확인 (VP-01~VP-07)
   - VP-05: 네이티브 테이블 빈 셀 / VP-06: 테이블 데이터 50%+ 공란 / VP-07: Shape 그리드 빈 셀 → 변환 로직 또는 원본 데이터 문제
   - 구조적 검사는 XML validator가 담당

2. **HTML ↔ PPTX 비교 검증**:
   **생략 조건**: Step 2.5에서 비교를 이미 수행했고, Step 4에서 HTML 수정이 전혀 없었으면 생략 가능 (동일 PPTX이므로 결과 동일).
   수정이 있었으면 수정된 슬라이드만 비교:
   ```bash
   node scripts/screenshot-html.mjs --slides-dir slides/프레젠테이션명 --output slides/프레젠테이션명/html-preview --slides "수정된번호"
   powershell -ExecutionPolicy Bypass -File scripts/export-slides-png.ps1 \
     -PptxPath "slides/프레젠테이션명/프레젠테이션명.pptx" \
     -OutputDir "slides/프레젠테이션명/preview" -Slides "수정된번호"
   ```
   `html-preview/` vs `preview/` PNG를 `Read`로 열어 비교:
   - 형태 변형 (원형→사각형, 그래프 왜곡)
   - 텍스트 잘림/이동, 색상 차이
   - 테이블 데이터 누락/공란
   - 미세 정렬 오류 (3-4pt도 4000px에서 감지 가능)
   - **IC 검증** (이미지 포함 슬라이드): IC-01~IC-04 체크리스트 실행 (`pf-step-2-2.5.md` §IC 검증 체크리스트 참조)

3. **VP/COM/IC ERROR/WARN → CLAUDE.md §공통 절차 실행 (필수)**
   VP/COM에서 ERROR/WARN이 발견되면 **즉시 3분류 판정 (오탐/정탐-수정/정탐-한계) → CLAUDE.md §공통 절차의 해당 체크리스트를 실행**:
   - HTML 수정 **전에** progress.md에 A~I 체크리스트 생성 (A. 판정 완료 후에만 수정 가능)
   - HTML 수정(슬라이드 내용) + PF/VP 규칙 추가(재발 방지) 양쪽 모두 완료해야 게이트 통과
   - 재변환 → VP/COM 재검증 (최대 2회)
   - 오탐/정탐-수정 → A~I 체크리스트 + 코드 수정 + 재검증
   - 정탐-한계 → 간소화 A~D (IL 기록 + 회피 규칙)

   흔한 VP/COM ERROR → HTML 수정 패턴:
   | VP/COM 코드 | 원인 | HTML 수정 방향 |
   |------------|------|---------------|
   | VP-04 대비 부족 | span background 손실, rgba 불투명화 | PF-55/PF-36 위반 수정 |
   | VP-16 텍스트 overflow | CJK 폭 계산 차이 | font-size 축소 또는 텍스트 축약 |
   | VC-02 높이 overflow | 콘텐츠 과밀 | 항목 감소 또는 슬라이드 분할 |
   | VC-04 shape 겹침 | absolute 요소 충돌 | 위치 조정 |

4. **이슈 확정 시 자동 수정**
   - HTML 수정 → 재변환 → 재검사 (최대 2회)
   - 수정 내용을 `.claude/docs/pptx-inspection-log.md`에 기록

5. **검사 기록 업데이트**
   - 발견된 이슈와 수정 내용을 로그에 추가
   - 검사 통과 시에도 "통과" 기록 남기기

### 6-3 → 파일 제공 게이트 (필수 — 컨텍스트 압축 후에도 유지)

**Step 6-3 HTML↔PPTX 비교 검증을 완료하기 전에 PPTX 다운로드 링크를 사용자에게 제공하는 것은 금지.**
Step 2.5 → Step 3 게이트와 동일 원칙.

**컨텍스트 압축 후 재개 시**: progress.md에 "Step 6-3 COM 비교 통과" 기록이 없으면 재실행.

**게이트 통과 시 필수 행동** (완료 게이트):
```
- [ ] 1. progress.md에 "Step 6-3 COM 비교 검증 통과" 기록
- [ ] 2. pptx-inspection-log.md에 수정 내용 기록 (수정이 있었으면)
- [ ] 3. 전부 [x] 확인 후 파일 제공
```
전부 `[x]` 전까지 PPTX 다운로드 링크 제공 금지.

5. **안내** (비교 검증 통과 후에만 실행)
   ```
   PPTX 파일 검사가 완료됐습니다!

   파일 위치: slides/프레젠테이션명/프레젠테이션명.pptx
   외부 다운로드: {터널URL}/output/프레젠테이션명.pptx

   이 파일을 더블클릭하면 PowerPoint에서 열립니다.
   텍스트, 도형, 색상 등을 자유롭게 수정할 수 있습니다.
   ```
   **터널 URL 확인**: 에디터 서버 실행 시 콘솔에 출력된 `Tunnel:` URL 사용. 에디터가 종료됐으면 터널도 종료 상태이므로 외부 링크 생략.

## Step 7 — PDF 생성

```bash
slides-grab pdf --slides-dir slides/프레젠테이션명 --output "slides/프레젠테이션명/프레젠테이션명.pdf"
```

**PDF 검증**: PDF는 Playwright 스크린샷 기반 변환이므로 HTML과 동일한 렌더링. 별도 검증 프로세스 없음.

변환 완료 후 안내:
```
PDF 파일이 만들어졌습니다!

파일 위치: slides/프레젠테이션명/프레젠테이션명.pdf
외부 다운로드: {터널URL}/output/프레젠테이션명.pdf
```

## Step 7.5 — 프로덕션 후 검증 (V-NN 실행 — 건너뛰기 금지)

Step 7 출력 완료 후, progress.md `## 탐지 코드 수정 검증` 섹션의 `[ ]` V-NN 항목을 **전부 실행**한다.
이 세션에서 코드 수정이 없었으면 (V-NN 항목이 0개) 이 단계는 생략.

**절차**:
1. progress.md `## 탐지 코드 수정 검증` 읽기
2. `[ ]` 미완료 V-NN 항목을 순차 실행:
   - **회귀 테스트** (V-01류): `node tests/detection-regression/run-pf-regression.mjs` 등 즉시 실행
   - **change-log 검증** (V-02류): 각 C-NN의 `**검증**:` 명령어를 실제 실행 → 전부 통과 시 change-log.md 삭제
   - **스트레스 테스트** (V-03/V-05류): `tests/stress-slides/{테스트명}/`에 **테스트 슬라이드 HTML 생성** (임계값 경계 TP/FP 케이스) → PF/VP 실행 → TP는 WARN/ERROR, FP는 미탐지 확인
   - **생성 규칙 검증** (V-04류): "다음 프레젠테이션에서 확인"은 이월 가능 — **유일한 이월 허용 유형**
3. 각 항목 통과 시 `[x]`로 갱신
4. **이월 기준**: 테스트 슬라이드 생성으로 검증 가능한 항목은 이월 금지. 이월은 "다음 프레젠테이션 프로덕션에서만 확인 가능"한 항목에 한정
5. **전부 `[x]` 후에만** 사용자에게 완료 보고
6. 마지막에 PF/VP 전체 회귀 테스트 1회 실행 (수정으로 인한 회귀 최종 확인)

**완료 게이트**: V-NN이 1개라도 `[ ]`이면 "다음" 또는 완료 보고 금지.
**하드 가드**: `checklist-guard.mjs` Rule 4가 Step 7 `[x]` 상태에서 V-NN `[ ]` 존재 시 차단.

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
