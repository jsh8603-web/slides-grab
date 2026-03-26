#### 탐지 규칙 추가/수정 시 필수 테스트 절차

탐지 규칙을 **추가하거나 수정**할 때, 아래 3단계를 **모두** 완료해야 한다. checklist-guard Rule 7b가 이를 강제한다 — 회귀 테스트 + 테스트 통과 키워드가 체크리스트에 없으면 이슈를 닫을 수 없다.

**적용 대상**: 모든 파이프라인 단계의 탐지 규칙 — PF, VP, COM(VV), IP, IV, VQA, IC

##### 1단계: 테스트 케이스 생성

파이프라인별로 적절한 테스트 입력을 생성한다.

| 파이프라인 | 테스트 입력 형식 | 테스트 폴더/DB |
|----------|--------------|-------------|
| **PF** | HTML 테스트 슬라이드 | `tests/stress-slides/{규칙명}/slide-NN.html` |
| **VP** | HTML → PPTX 변환 후 검증 | `tests/stress-slides/{규칙명}/slide-NN.html` |
| **COM (VV)** | HTML + PPTX 쌍 비교 | `tests/stress-slides/{규칙명}/` |
| **IP** | 프롬프트 텍스트 | 회귀 DB `ip-iv-cases.json` |
| **IV** | 생성 이미지 + 메타데이터 | 회귀 DB `ip-iv-cases.json` |
| **VQA** | 이미지 + 스코어링 기준 | 회귀 DB (해당 시 별도 생성) |
| **IC** | 이미지 + 검증 기준 | 회귀 DB (해당 시 별도 생성) |

**필수 케이스 구성** (최소 6개):
- **TP (True Positive)** 2개+: 규칙이 탐지해야 하는 정상 케이스
- **FP (False Positive 방지)** 2개+: 규칙이 탐지하면 안 되는 유사 패턴
- **Edge Case** 2개+: 경계값, 극단값, 복합 조건

**Edge Case 설계 원칙** (전 파이프라인 공통):
- 경계값: 임계값 ±1 (예: PF childCount=3 vs 4, IV score 2.9 vs 3.0)
- 극단값: 최소/최대 값 (예: 자식 0개/20개, 이미지 1px/4096px)
- 복합 조건: 2개+ 규칙 동시 트리거 (예: PF-56+PF-57, IP-12+IP-15)
- 구조 변형: 주석 내 패턴, 중첩 구조, CSS class vs inline (PF/VP), 프롬프트 변형 (IP)
- 파이프라인 연쇄: 전단계 통과 입력이 후단계에서도 정상인지 (PF→VP→COM)

HTML 기반 테스트(PF/VP/COM)는 `manifest.json`으로 기대 결과를 기록한다.

##### 2단계: 회귀 테스트 실행

PF/VP 규칙 수정 시 **풀슬라이드 회귀 테스트**를 실행한다. 과거 프레젠테이션 전체에 PF/VP를 실행하여 baseline과 비교, 새로 생긴 이슈가 있으면 회귀.

```bash
# 풀슬라이드 회귀 (PF + VP, Playwright 포함)
node tests/run-full-regression.mjs

# PF만 / VP만 / Playwright 생략
node tests/run-full-regression.mjs --pf-only
node tests/run-full-regression.mjs --vp-only
node tests/run-full-regression.mjs --no-full

# baseline 갱신 (PF/VP 규칙 변경 확정 후)
node tests/run-full-regression.mjs --save

# IP/IV 단위 회귀
node tests/detection-regression/run-ip-iv-regression.mjs
```

##### 3단계: 스트레스 + 풀슬라이드 회귀 동시 실행

```bash
# 코드 수정 후 의무 실행 순서:
node tests/run-full-regression.mjs                     # PF+VP 풀슬라이드 회귀
node tests/detection-regression/run-ip-iv-regression.mjs # IP/IV 단위 회귀
node tests/stress-slides/run-stress.mjs --dir {테스트명}  # 통합 스트레스 (신규 규칙 시)
```

**두 테스트 모두 통과해야** 이슈를 닫을 수 있다. Rule 7b가 체크리스트에 `테스트 PASS` + `회귀` 키워드를 모두 요구한다.

---

#### 풀슬라이드 회귀 테스트 — 과거 프레젠테이션 대상

`tests/run-full-regression.mjs`는 과거 프레젠테이션(19개, 329+ 슬라이드) 전체에 PF `--full`(Playwright) + VP를 실행하고, baseline과 비교하여 **새로 생긴 이슈만** 보고한다.

**baseline**: `tests/detection-regression/full-baseline.json`
- PF/VP 규칙 변경 확정 후 `--save`로 갱신
- 변경 없이 비교 시 0 regression (일관성 보장)

**일상 사용 절차** (PF/VP 코드 수정 시):
```
PF/VP 코드 수정
  → 비교 실행: node tests/run-full-regression.mjs
  → 새 이슈 0건 → 수정 완료
  → 새 이슈 N건 → 오탐 여부 판정 → PF/VP 재수정 → 반복
  → 확정 후: node tests/run-full-regression.mjs --save
```

**자동 탐색**: `slides/` 하위에서 `slide-*.html`이 있는 디렉토리 + 디렉토리명과 일치하는 PPTX 자동 탐색. 테스트 슬라이드는 `tests/`에 별도 보관 (slides/ 폴더에 없음).

---

#### 스트레스 테스트 — 코드 수정 후 의무 절차

회귀 테스트는 기존 슬라이드에 새 오탐이 생기는지 검증한다. 스트레스 테스트는 **신규 규칙의 edge case를 재현하는 HTML 테스트 슬라이드를 생성하여 전체 파이프라인(PF→변환→VP→COM)을 통과**시켜 코드 변경의 통합 동작을 검증한다.

**테스트 슬라이드 폴더**: `tests/stress-slides/{테스트명}/`

**설계 절차** (change-log.md 검증 완료 후):
1. 수정한 코드별 **edge case 목록** 작성 (경계값, 극단값, 복합 조건)
2. 각 edge case를 재현하는 **HTML 테스트 슬라이드 생성** (`tests/stress-slides/{테스트명}/slide-{NN}.html`)
3. 테스트 슬라이드에 **기대 결과 매니페스트** 작성 (`manifest.json`)
4. **전체 파이프라인 실행**: PF → convert-native → VP
5. 매니페스트 대비 실제 결과 비교
6. FAIL 시: 코드 수정 → 재실행

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

**검증 완전성 원칙 — 스트레스 + 풀슬라이드 회귀 동시 실행**:
스트레스 테스트(통합)와 풀슬라이드 회귀 테스트는 **항상 함께** 실행한다. 풀슬라이드 회귀만 통과하고 스트레스에서 실패하면 통합 동작이 깨진 것이고, 스트레스만 통과하고 회귀에서 실패하면 과거 슬라이드에 새 오탐이 생긴 것이다.

**테스트 결과물 보존 규칙**:
- 테스트 완료 후 **HTML 슬라이드 + manifest.json은 보존** (분석·재실행용)
- **생성된 PPTX, 대용량 이미지(>100KB)는 삭제** — runner가 자동 삭제 (`fs.unlinkSync(pptxPath)`)
- **더미 테스트 이미지(`assets/`)는 보존** (1KB 미만, 파이프라인 실행에 필요)
- `tests/stress-slides/`는 HTML 기반 통합 스트레스
- 각 테스트 폴더에 **README.md** 또는 manifest.json의 `description`으로 테스트 목적 명시

**프로덕션 파이프라인 자동 테스트**:
```bash
# baseline 측정 (변경 전):
node scripts/auto-production-test.mjs --slides 10 --baseline --runs 3
# comparison 측정 (변경 후):
node scripts/auto-production-test.mjs --slides 10 --compare tests/production-runs/baseline-10.json --runs 3
```
품질 게이트: PF/VP error 증가 불가, VQA avg -0.5 이하 시 FAIL, VQA min -1.0 이하 시 FAIL
