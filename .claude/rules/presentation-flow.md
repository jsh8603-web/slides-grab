# 프레젠테이션 워크플로우 (트리거)

프레젠테이션 요청 감지 시 → 상세 절차: `.claude/docs/presentation-flow.md` 읽기

## 트리거 매핑

| 사용자 발화 | 시작 지점 |
|------------|----------|
| "~~ 주제로 만들어줘" / "프레젠테이션 만들어줘" | Step 0 |
| "아웃라인 검토해줘" / outline 파일 제공 | Step 2 |
| "슬라이드 수정해줘" / "편집기 열어줘" / "에디터 열어줘" | Step 3 |
| "pptx 변환" / "pdf 변환" / "내보내기" | Step 5 |

## 세션 복원 (컨텍스트 압축 포함)

progress.md는 각 Step 완료·수정 발생·로그 기록 시 **즉시 갱신**하여 상시 최신 유지 (자동 압축은 예고 없이 발생하므로).

**새 세션 첫 행동** (대화 요약보다 우선, 컨텍스트 압축 후에도 동일):
1. `slides/프레젠테이션명/progress.md`를 Read
2. `## 활성 규칙`의 `[ ]` 미체크 항목 → **해당 docs 파일을 즉시 Read로 재로드** (이 단계를 건너뛰면 이후 절차 위반의 근본 원인이 됨)
3. **미완료 이슈 체크리스트 확인** → `### 이슈 #N` 하위에 `[ ]` 미완료 항목 → 해당 항목부터 처리 완료 후 작업 재개 (CLAUDE.md §공통 절차 참조)
4. `## 로그 기록 상태`에 `[ ]` 미기록 항목 → `pptx-inspection-log.md`에 먼저 기록
5. 게이트 통과 기록 없으면 해당 Step 재실행
6. 위 1~5 완료 후에만 작업 재개

| 체크포인트 | 검증 방법 | 미충족 시 |
|-----------|----------|----------|
| **활성 규칙 재로드** | **progress.md `## 활성 규칙`의 `[ ]` 항목** | **해당 규칙 파일 Read로 재로드** |
| Step 0 소스 확인 | progress.md 또는 사용자 번호 응답 | Step 0 재시작 |
| Step 1 아웃라인 승인 | progress.md 또는 "진행" 응답 | 아웃라인 재제시 |
| Step 1.5A 초안 확인 | progress.md 또는 "진행" 응답 | 초안 재생성 |
| Step 1.5B 이미지 생성 | assets/ 폴더에 이미지 존재 | 이미지 재생성 |
| **Step 2.5 COM 비교** | **progress.md "통과" 기록** | **에디터 링크 제공 금지, Step 2.5 재실행** |
| **Step 4 수정 재검증** | **수정 유형별 재검증 매트릭스 준수** | **재검증 미완료 시 Step 5 진행 금지** |
| **Step 6-3 COM 비교** | **progress.md "통과" 기록** | **다운로드 링크 제공 금지, Step 6-3 재실행** |
| **Step 7.5 V-NN 검증** | **progress.md `## 탐지 코드 수정 검증`의 V-NN 전부 `[x]`** | **완료 보고 금지, V-NN 순차 실행** |

## Step별 로드 규칙 (토큰 최적화)

현재 Step에 해당하는 `docs/` 파일만 Read. **완료된 Step의 파일/스킬 재로드 금지.**

| Step | Step 절차 파일 | 추가 Read 대상 (docs/ 경로 생략) | 로드 금지 |
|------|------|------|------|
| 0-1 소스/아웃라인 | `pf-step-0-1.md` | `design-modes.md`, `production-reporting-rules.md`(1회), `plan-skill` 호출 | nanoBanana, pptx-inspection-log |
| 1.5B 이미지 | `pf-step-1.5b.md` | `nanoBanana-guide.md`, `vqa-pipeline-maintenance.md` | design-modes, html-prevention-rules |
| 2-2.5 HTML/검증 | `pf-step-2-2.5.md` | **`design-skill`** 호출, `html-prevention-rules.md`, `pptx-inspection-log.md` | nanoBanana, vqa, design-modes |
| 3-4 에디터/수정 | `pf-step-3-4.md` | `html-prevention-rules.md` (수정 시만), `nanoBanana-guide.md` (이미지 교체 시만) | 조건 미해당 파일 |
| 5-6-7 변환 | `pf-step-5-6-7.md` | **`pptx-skill`** 호출, `html-prevention-rules.md`, `pptx-inspection-log.md` | nanoBanana, design-modes, design-skill |

**공통 규칙**:
- `progress.md`는 매 Step에서 Read/Write
- `production-reporting-rules.md`는 **Step 1에서 1회만** Read (이후 재로드 금지)
- `presentation-flow.md`는 **현재 Step 섹션만** Read (offset/limit 사용, 전체 Read 금지)
- 스킬 호출(bold)은 해당 Step 진입 시 1회만. Step 전환 시 이전 스킬 재호출 금지
- **이미 컨텍스트에 있는 파일은 재로드 금지** — 대화 압축 후에만 재로드 (progress.md `## 활성 규칙` 참조)
