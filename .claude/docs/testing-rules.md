#### 회귀 테스트 — 탐지 코드 수정 전 의무 절차

탐지 코드(PF/VP/IP/IV/VQA) 수정 시 오탐 수정이 정탐 미탐지(false negative)를 유발하지 않는지 검증한다.

**회귀 테스트 DB**: `tests/detection-regression/`
- `vp-cases.json` — VP-14 (shape overlap), VP-16 (CJK overflow) 회귀 케이스
- `ip-iv-cases.json` — IP (prompt preflight), IV (image validate) 회귀 케이스
- 각 케이스: `type` (true_positive/false_positive), `expectedLevel`, `status` (known_issue 가능)

**테스트 러너**:
```bash
node tests/detection-regression/run-pf-regression.mjs    # PF 단위 회귀
node tests/detection-regression/run-vp-regression.mjs    # VP 단위 회귀
node tests/detection-regression/run-ip-iv-regression.mjs # IP/IV 단위 회귀
```

**수정 전 의무 절차** (탐지 코드 Edit 전에):
1. 해당 규칙의 회귀 케이스가 DB에 있는지 확인
2. 없으면: 현재 오탐/정탐 케이스를 DB에 추가 (수정 전 동작 기록)
3. 코드 수정 후: 러너 실행하여 0 failed 확인
4. 새로운 known_issue 발견 시: `status: "known_issue"` + `actualLevel` 기록

**케이스 추가 시점**:
- 오탐 수정 시: 해당 오탐 케이스(false_positive) + 관련 정탐 케이스(true_positive) 모두 추가
- 정탐 미탐지 발견 시: 해당 케이스를 true_positive로 추가
- 프로덕션 검증 중 새 패턴 발견 시: 즉시 DB에 추가

#### 스트레스 테스트 — 코드 수정 후 의무 절차

회귀 테스트(JSON DB)는 단일 규칙의 입출력만 검사한다. 스트레스 테스트는 **실제 HTML 테스트 슬라이드를 생성하여 전체 파이프라인(PF→변환→VP→COM)을 통과**시켜 코드 변경의 통합 동작을 검증한다.

**목적**: 회귀 테스트가 단위 검증이라면, 스트레스 테스트는 통합 검증. 실제 슬라이드 구조에서 edge case가 파이프라인 전체에 미치는 영향을 확인.

**테스트 슬라이드 폴더**: `tests/stress-slides/{테스트명}/`

**설계 절차** (change-log.md 검증 완료 후):
1. 수정한 코드별 **edge case 목록** 작성 (경계값, 극단값, 복합 조건)
2. 각 edge case를 재현하는 **HTML 테스트 슬라이드 생성** (`tests/stress-slides/{테스트명}/slide-{NN}.html`)
3. 테스트 슬라이드에 **기대 결과 매니페스트** 작성 (`manifest.json`)
4. **전체 파이프라인 실행**: PF → convert-native → VP
5. 매니페스트 대비 실제 결과 비교
6. FAIL 시: 코드 수정 → 회귀 DB에 케이스 추가 → 재실행

**매니페스트 형식** (`tests/stress-slides/{테스트명}/manifest.json`):
```json
{
  "name": "PF-56/57 스트레스 테스트",
  "description": "이미지 컨테이너 height 누락 + 소형 이미지 edge cases",
  "cases": [
    {
      "slide": "slide-01.html",
      "description": "flex centering + no height → PF-56 WARN",
      "expect": { "PF-56": "WARN" }
    },
    {
      "slide": "slide-02.html",
      "description": "flex centering + height:100% → PF-56 clean",
      "expect": { "PF-56": null }
    }
  ]
}
```

**edge case 설계 원칙**:
- **경계값**: 임계값 ±1 (예: width 99pt vs 100pt vs 101pt)
- **극단값**: 매우 작은/큰 값 (예: width 1pt, width 720pt)
- **복합 조건**: 2개+ 규칙이 동시 트리거 (예: PF-56 + PF-57 동시)
- **CSS class vs inline**: 인라인 스타일과 CSS class 양쪽에서 동작 확인
- **중첩 구조**: 다단 flex 중첩, 이미지 컨테이너 내 추가 div
- **파이프라인 통합**: PF 통과 슬라이드가 VP에서도 정상인지 (PF→VP 연쇄)

**러너**: `node tests/stress-slides/run-stress.mjs --dir {테스트명}`
**트리거**: change-log.md 검증 시점에 해당 코드의 스트레스 테스트 존재 여부 확인 → 없으면 생성 후 실행

**검증 완전성 원칙 — 스트레스 + 회귀 동시 실행**:
스트레스 테스트(통합)와 회귀 테스트(단위)는 **항상 함께** 실행한다. 스트레스만 통과하고 회귀에서 실패하면 기존 정탐이 깨진 것이고, 회귀만 통과하고 스트레스에서 실패하면 통합 동작이 깨진 것이다.
```bash
# 코드 수정 후 의무 실행 순서:
node tests/detection-regression/run-pf-regression.mjs    # PF 단위 회귀
node tests/detection-regression/run-vp-regression.mjs    # VP 단위 회귀
node tests/detection-regression/run-ip-iv-regression.mjs # IP/IV 단위 회귀
node tests/stress-slides/run-stress.mjs --dir {테스트명}  # 통합 스트레스
```

**테스트 결과물 보존 규칙**:
- 테스트 완료 후 **HTML 슬라이드 + manifest.json은 보존** (분석·재실행용)
- **생성된 PPTX, 대용량 이미지(>100KB)는 삭제** — runner가 자동 삭제 (`fs.unlinkSync(pptxPath)`)
- **더미 테스트 이미지(`assets/`)는 보존** (1KB 미만, 파이프라인 실행에 필요)
- 기존 `tests/detection-regression/`은 JSON DB 기반 단위 회귀, `tests/stress-slides/`는 HTML 기반 통합 스트레스
- 각 테스트 폴더에 **README.md** 또는 manifest.json의 `description`으로 테스트 목적 명시

**프로덕션 파이프라인 자동 테스트**:
```bash
# baseline 측정 (변경 전):
node scripts/auto-production-test.mjs --slides 10 --baseline --runs 3
# comparison 측정 (변경 후):
node scripts/auto-production-test.mjs --slides 10 --compare tests/production-runs/baseline-10.json --runs 3
```
품질 게이트: PF/VP error 증가 불가, VQA avg -0.5 이하 시 FAIL, VQA min -1.0 이하 시 FAIL
