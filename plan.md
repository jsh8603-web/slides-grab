# 토큰 최적화 계획 v3

## 핵심 원리

**rules/** = 매 대화 자동 로드 (토큰 고정 비용)
**skills/** = 프로세스 트리거 시에만 로드 (온디맨드)

→ rules/ 중 불필요한 **참조 데이터**만 제거하고, **규칙 자체**는 한 곳에 유지

---

## v2에서 발견된 구조적 위험

### 위험 1: 수정 기록 위치 혼란

현재 "수정 기록 의무"는 단순: **3곳 업데이트** (inspection-log + prevention-rules + 스크립트)

v2 방안 1 (WARN을 design-skill로 이동) 적용 시:
- "이 규칙은 ERROR인가 WARN인가?" 판단 분기가 추가됨
- ERROR → rules/ 업데이트, WARN → design-skill/ 업데이트
- **즉석 버그 수정 시 잘못된 파일에 기록하거나 누락할 위험**

### 위험 2: Single Source of Truth 위반

html-prevention-rules.md가 HTML 규칙의 **유일한 출처** 역할:
- design-skill도 참조, pptx-skill도 참조, 즉석 수정도 참조
- 규칙을 두 곳에 분산하면 **동기화 실패** 위험
- 새 규칙 추가 시 "어디에 넣지?" 고민 발생

### 위험 3: 스킬 라우팅 모호

현재: 어떤 단계든 html-prevention-rules.md는 **항상 보임** (auto-loaded)
분산 후: Step 2에서 WARN은 design-skill 내부, Step 6에서 WARN은... pptx-skill에 없음
- pptx 변환 에러 디버깅 시 WARN 규칙을 확인하려면 design-skill을 별도로 열어야 함

---

## 수정된 방안 1: 규칙 유지 + 참조 데이터만 이동

**원칙 변경**: 규칙(ERROR+WARN)은 rules/에 **모두 유지** → Single Source of Truth 보존.
참조 데이터(매핑 테이블, 변환기 이력)만 docs/로 이동 + 규칙 텍스트 압축.

### 이동 대상 (규칙이 아닌 참조 데이터)

| 구분 | 줄 수 | 이동 | 이유 |
|------|-------|------|------|
| 매핑 테이블 (PF/VP ↔ IL 대응표) | 35줄 | → docs/pptx-inspection-log.md | 디버깅 참조용, 규칙 준수에 불필요 |
| 변환기 내부 수정 이력 | 6줄 | → docs/pptx-inspection-log.md | html2pptx.cjs 이력, HTML 작성과 무관 |
| 레이아웃 템플릿 참조 포인터 | 2줄 | → design-skill에 이미 존재 | 중복 제거 |

### 잔류 (rules/에 유지)

| 구분 | 줄 수 | 이유 |
|------|-------|------|
| 수정 기록 의무 | 10줄 | 프로세스 규칙 (항상 필요) |
| 금지 규칙 (ERROR) 7개 | 9줄 | 변환 실패 방지 |
| 필수 규칙 (WARN) 12개 | 14줄 | 레이아웃 깨짐 방지 |
| 테이블 레이아웃 4개 | 5줄 | CSS grid 필수 패턴 |
| 높이 계산 공식 | 4줄 | 코드 블록 제거, 텍스트만 |

### 압축 (기존 규칙 텍스트 간소화)

높이 계산 코드 블록 (``` ... ```) → 한 줄 수식으로 압축

**결과**: rules/ 100줄 → ~55줄 (**-45줄**)
**수정 기록 의무**: 변경 없음 — 여전히 "이 파일에 추가" 한 곳
**스킬 라우팅**: 변경 없음 — 모든 단계에서 rules/ 자동 참조

---

## 방안 2: presentation-flow.md 정리 (v2와 동일)

체크포인트 유지, 단계 요약(presentation-skill과 중복) 제거

**결과**: rules/ 35줄 → ~28줄 (**-7줄**)

---

## 방안 3: 검증 출력 요약 모드 --summary (v2와 동일)

ERROR 상세 출력 + WARN 규칙별 집계+파일 목록

```
❌ ERROR [slide-03.html] PF-01: linear-gradient with white text

PF-08: 10 slides (slide-04~14) — CJK text in card >11pt
PF-23: 11 slides (slide-04~15) — CJK text density overflow
```

**결과**: 검증 출력 -80%

---

## 방안 4: design-skill Chart/Diagram/Image 분리 (v2와 동일)

Chart.js + Mermaid + SVG + Image 가이드 (~186줄) → `design-skill/media-guide.md`
아웃라인에 차트/다이어그램/이미지가 있을 때만 Read.

**결과**: design-skill 685줄 → ~499줄 (**-186줄**)

### 라우팅 명확화

SKILL.md에 참조 분기 추가:
```
## 참조 파일 로드 규칙
- 차트/다이어그램/이미지 슬라이드 존재 → `media-guide.md` Read
- PPTX 변환 이슈 디버깅 → `pptx-inspection-log.md` Read
- 디자인 모드 상세 → `design-modes.md` Read
- 위 해당 없으면 추가 Read 불필요
```

---

## 방안 5: pptx-skill 에러 시에만 참조 (v2와 동일)

SKILL.md에 명시: "정상 변환 시 html2pptx.md/ooxml.md Read 불필요, 에러 발생 시에만 참조"

**결과**: 정상 변환 시 -1,051줄

---

## 방안 6: 스킬 중복 제거 — 비-안전 항목만 (v2와 동일)

안전 규칙 반복은 의도적으로 유지. 파일명 규칙, 참조 경로 등 비-안전 중복만 제거.

**결과**: 총 -30줄

---

## 방안 7: --diff 재검사 (v2와 동일)

Phase 3 (크로스 슬라이드)는 전체 유지, Phase 1~2만 diff 대상.

**결과**: 반복 검증 -70%

---

## 스킬 라우팅 매트릭스 (혼란 방지)

각 상황에서 어떤 파일을 참조하는지 명시. 이 매트릭스를 presentation-skill에 추가.

| 상황 | auto-loaded (항상 보임) | 스킬 | 추가 Read (조건부) |
|------|----------------------|------|-------------------|
| 프레젠테이션 새로 만들기 | CLAUDE.md + prevention-rules + flow | presentation-skill → plan-skill → design-skill | design-modes.md, nanoBanana-guide.md |
| HTML 슬라이드 생성 (Step 2) | CLAUDE.md + prevention-rules | design-skill | media-guide.md (차트 시), design-modes.md |
| HTML 즉석 수정 (스킬 미호출) | CLAUDE.md + prevention-rules | — | — |
| PPTX 변환 (Step 6) | CLAUDE.md + prevention-rules | pptx-skill | html2pptx.md (에러 시), pptx-inspection-log.md |
| 레이아웃 버그 수정 | CLAUDE.md + prevention-rules | — | pptx-inspection-log.md (패턴 기록) |
| 검증 규칙 추가 | CLAUDE.md + prevention-rules | — | pptx-inspection-log.md (매핑 테이블) |

**핵심**: prevention-rules.md는 **모든 상황**에서 auto-loaded → 규칙 누락 없음.
스킬 미호출 상황(즉석 수정, 버그 수정)에서도 규칙이 보임.

---

## 우선순위

| 순위 | 방안 | 절감 | 퀄리티 위험 | 혼란 위험 |
|------|------|------|-----------|----------|
| 1 | **방안 1 (v3)**: 참조 데이터만 이동 + 압축 | **매 대화 -45줄** | NONE | NONE — Single Source 유지 |
| 2 | **방안 3**: --summary 옵션 | **검증 시 -80%** | LOW | NONE |
| 3 | **방안 5**: pptx 참조 선택적 로드 | **변환 시 -1,051줄** | LOW | NONE |
| 4 | **방안 4**: Chart/Image 분리 + 라우팅 명확화 | **호출 시 -186줄** | LOW | LOW — 라우팅 규칙 명시 |
| 5 | **방안 6**: 비-안전 중복만 제거 | **호출 시 -30줄** | LOW | NONE |
| 6 | **방안 2**: 단계 요약 제거 | **매 대화 -7줄** | NONE | NONE |
| 7 | **방안 7**: --diff 재검사 | **반복 -70%** | LOW | NONE |

---

## 수정 파일

| 파일 | 변경 |
|------|------|
| `.claude/rules/html-prevention-rules.md` | 매핑 테이블+이력+포인터 제거, 높이 계산 압축 (~55줄) |
| `.claude/rules/presentation-flow.md` | 단계 요약 제거 (~28줄) |
| `.claude/skills/design-skill/SKILL.md` | Chart/Image → media-guide.md 분리, 라우팅 규칙 추가 |
| `.claude/skills/design-skill/media-guide.md` | 신규: Chart.js/Mermaid/SVG/Image 가이드 (~186줄) |
| `.claude/skills/presentation-skill/SKILL.md` | 스킬 라우팅 매트릭스 추가 |
| `.claude/skills/pptx-skill/SKILL.md` | "에러 시에만 참조" 명시 |
| `.claude/docs/pptx-inspection-log.md` | 매핑 테이블 + 변환기 내부 이력 수용 |
| `scripts/preflight-html.js` | --summary 옵션 추가 |

## 예상 총 절감 (v3)

- **매 대화 자동 로드**: 178줄 → 126줄 (**-29%**, v2 -43%에서 축소 — 안전+혼란 방지 우선)
- **design-skill 호출 시**: 685줄 → 499줄 (**-27%**)
- **정상 PPTX 변환**: -1,051줄 참조 파일 절약
- **검증 출력**: -80% 토큰 절감 (--summary)
- **반복 검증**: -70% (--diff)

## v2 → v3 변경 요약

| 항목 | v2 | v3 | 이유 |
|------|-----|-----|------|
| 방안 1 | WARN을 design-skill로 이동 (-70줄) | 참조 데이터만 이동 + 압축 (-45줄) | 규칙 분산 → 수정 기록 혼란 + SSoT 위반 |
| 매 대화 절감 | -43% | -29% | 규칙을 한 곳에 유지하는 대가 |
| 스킬 라우팅 | 암묵적 | **매트릭스 명시** | 혼란 방지 |
| 수정 기록 의무 | 2곳 분산 | **1곳 유지** | 기록 누락 방지 |
