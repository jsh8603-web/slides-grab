# VQA 파이프라인 보수 기준

이미지 생성 플로우 실행 후, 아래 기준으로 파이프라인을 점검하고 즉시 수정한다.
"향후 개선" 항목으로 미루지 않는다 — 발견 즉시 수정.

## 0. 3분류 판정 — 수정 대상이 다르다

에러 발견 시 먼저 **3분류 판정 (오탐/정탐-수정/정탐-한계)**. 판정에 따라 수정 대상과 체크리스트가 달라진다:

| 탐지 프로세스 | 오탐 시 수정 (탐지 코드) | 정탐-수정 시 수정 (생성 코드) | 정탐-한계 시 행동 |
|:------------:|---------------------------|---------------------------|----------------|
| **IV** | `generate-images.mjs` IV 검증부 | `nanoBanana-guide.md` 프롬프트 규칙 | IL 기록 + 해당 구도 금지 |
| **IP** | `generate-images.mjs` IP 검증부 | `nanoBanana-guide.md` + `enhancePrompt()` | (거의 없음 — 프롬프트 수정 항상 가능) |
| **IC** | IC 검증 프롬프트/임계값 | `plan-skill/SKILL.md` 아웃라인 이미지 설명 규칙 | IL 기록 + 추상 메타포 대체 |
| **VQA** | `scoreImageWithVQA` 프롬프트/임계값 | `nanoBanana-guide.md` + `enhancePrompt()` | IL 기록 + 해당 카테고리 게이트 하향 |

체크리스트: 오탐/정탐-수정 → `CLAUDE.md` §공통 절차 A~I, 정탐-한계 → 간소화 A~D.

**기록 의무 (판정 무관):** 모든 에러를 `pptx-inspection-log.md`에 기록. 오탐은 "오탐", 정탐-한계는 "정탐-한계 + 한계 원인" 명시.

## 1. 토크나이저 노이즈 검출

### 실행 시점
- `--vqa --update-scores` 또는 `--vqa-only --update-scores` 실행 후
- `prompt-keyword-scores.json` 또는 `nanoBanana-prompt-scores.json` 갱신될 때마다

### 검출 기준
키워드 스코어 결과에서 아래 패턴이 발견되면 **즉시 `tokenizePrompt()` 수정**:

| 노이즈 유형 | 예시 | 수정 위치 |
|------------|------|----------|
| 스타일 앵커 잔여물 | `color`, `palette`, `primary`, hex 코드 | `metaKeys` 패턴 또는 STOPWORDS |
| Aspect ratio 조각 | `portrait`, `16`, `9`, `portrait aspect` | STOPWORDS |
| 위치 지시어 | `left`, `right`, `top-left`, `bottom-right` | STOPWORDS |
| 부정형 절 단어 | `currency`, `symbols`, `pure`, `only` | STOPWORDS |
| 보일러플레이트 문장 | `text 16`, `high resolution` | `cleaned.replace()` 패턴 |
| 모든 이미지 공통 키워드 | count = 전체 이미지 수와 동일, avg ≈ 전체 평균 | 의미 없는 키워드 → STOPWORDS 추가 |

### 검증 방법
```bash
# 키워드 스코어 상위 20개 확인
node -e "const j=JSON.parse(require('fs').readFileSync('.claude/docs/nanoBanana-prompt-scores.json','utf8')); ..."
```
상위 20개 키워드 중 **사진 기법/피사체/분위기가 아닌 키워드**가 있으면 노이즈.

### 수정 후 필수 절차 (완료 게이트: 전부 `[x]` 전까지 다음 작업 차단)
1. `node -c scripts/generate-images.mjs` syntax check
2. 샘플 프롬프트 3개로 토크나이저 출력 확인
3. 누적 DB 초기화 후 `--force --update-scores`로 재구축 (또는 다음 생성 시 자연 갱신)

## 2. VQA 게이트 조정

### 실행 시점
- 생성 결과에서 PASS/WARN/FAIL 비율 확인 후

### 조정 기준

| 현상 | 진단 | 수정 |
|------|------|------|
| FAIL이 50%+ | VQA 프롬프트가 너무 엄격하거나 임계값이 낮음 | `scoreImageWithVQA` 시스템 프롬프트 완화 또는 게이트 임계값(현재 20) 하향 |
| PASS가 90%+ | VQA가 너무 관대 | 시스템 프롬프트에 "Be strict" 강화 |
| 재시도 3회 후에도 FAIL 비율 높음 | 프롬프트 자체 또는 모델 한계 | `mutatePromptForRetry` 전략 개선 |
| 특정 카테고리만 저점 | 카테고리별 평가 기준 차이 | `scoreImageWithVQA`에 카테고리별 기준 분기 |

### 현재 게이트 임계값
- total < 20 → FAIL (재시도)
- 20-22 → WARN (저장, 경고)
- 23+ → PASS

## 3. IV/IP 규칙 조정

### 실행 시점
- 생성 중 특정 IV/IP WARN이 대다수 이미지에서 발생할 때

### 조정 기준

| 현상 | 수정 |
|------|------|
| IV-09 WARN이 80%+ 이미지에서 발생 | 임계값 상향 또는 dominant color 추출 로직 개선 |
| IV-10 WARN이 커버/배경에서 발생 | 카테고리별 edge density 범위 분리 (이미 적용됨) |
| IP-08(길이 초과) 빈발 | 프롬프트 자동 축약 로직 추가 또는 임계값 상향 |
| IP-09(비율 불일치) 오탐 | 키워드 매칭 패턴 정밀화 |

## 4. 보수 사이클

25장 생성 후:
1. `nanoBanana-report.json` 확인 → VQA 분포, 카테고리별 평균
2. `prompt-keyword-scores.json` 확인 → 노이즈 키워드 유무
3. 이상 발견 시 즉시 수정 (토크나이저, 게이트, IV/IP 규칙)
4. 수정 후 다음 25장 생성 전 syntax check + 샘플 테스트
5. 반복
