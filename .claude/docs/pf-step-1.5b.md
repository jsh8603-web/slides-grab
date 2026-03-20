# Step 1.5B — NanoBanana 이미지 자동 생성

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
| `--concurrency` | `3` | 동시 호출 수 (IPM 제한 고려) |
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

### IP/IV 자동 검수 (스크립트 내장)

`generate-images.mjs`가 생성 전 IP(Image Preflight) + 생성 후 IV(Image Validate)를 자동 실행한다.
결과는 콘솔 출력 + `assets/slide-{NN}-meta.json`에 기록.

- **IP ERROR** (한글 프롬프트, 숫자 데이터 포함) → 해당 이미지 자동 건너뜀
- **IV FAIL** (Safety 차단, 거의 흰색, 10KB 미만) → 프롬프트 수정 후 재생성 필요
- **IP/IV WARN** → 경고 출력 후 생성 계속

방향 전환: IV FAIL 2회 시 유형 전환 (메타포→일러스트→아이콘→SVG→HTML), 3회 시 HTML-only.
상세 규칙: `nanoBanana-guide.md` "이미지 검수 프로세스 (IP/IV/IC)" 섹션 참조.

### IP/IV/IC/VQA 에러 발생 시 — 3분류 판정 + 코드 수정 (필수)

에러 발견 시 **3분류 판정 (오탐/정탐-수정/정탐-한계)** → 판정에 따라 체크리스트가 달라진다.
체크리스트 구조: `CLAUDE.md` §공통 절차 참조 (오탐/정탐-수정 → A~I, 정탐-한계 → 간소화 A~D).

#### 단계별 3분류 판정 기준 + 즉시 행동

**IP (프롬프트 검증)**:
| 판정 | 기준 | 수정 대상 | 재검증 |
|------|------|----------|--------|
| 오탐 | 프롬프트가 정상인데 IP가 ERROR/WARN 잘못 발생 | `generate-images.mjs` validateImageIP() | 동일 프롬프트 `--dry` 재실행 → IP 에러 소멸 확인 |
| 정탐-수정 | 프롬프트에 실제 문제 (한글, 숫자 데이터 등) | `nanoBanana-guide.md` + `plan-skill/SKILL.md` NanoBanana 태그 | 프롬프트 수정 후 `--dry` 재실행 → IP PASS 확인 |
| 정탐-한계 | **(IP는 프롬프트 검사 → 수정 항상 가능, 거의 없음)** | — | — |

**IV (생성 후 메타데이터 검증)**:
| 판정 | 기준 | 수정 대상 | 재검증 |
|------|------|----------|--------|
| 오탐 | 이미지가 정상인데 IV 임계값이 너무 엄격 | `generate-images.mjs` validateImage() 임계값 | 동일 이미지에 수정된 IV 재실행 → WARN/FAIL 소멸 확인 |
| 정탐-수정 | 이미지에 실제 문제 (너무 어둡고, 거의 흰색 등) | `nanoBanana-guide.md` 프롬프트 규칙 + `enhancePrompt()` | `--regenerate {번호}` 재생성 → IV PASS 확인 |
| 정탐-한계 | Gemini 모델이 특정 구도/스타일 생성 불가 | — | IL 기록 + 회피 규칙 (해당 구도 금지) |

**VQA (품질 스코어링)**:
| 판정 | 기준 | 수정 대상 | 재검증 |
|------|------|----------|--------|
| 오탐 | 이미지 품질은 좋은데 VQA 점수가 낮음 (모델 오판) | `generate-images.mjs` scoreImageWithVQA() 프롬프트/게이트 | 게이트 조정 후 기존 WARN 이미지 5개 재스코어링 → 점수 변화 확인 |
| 정탐-수정 | VQA가 정확히 문제 짚음 (프롬프트 불이행, 텍스트 포함 등) | `nanoBanana-guide.md` + `enhancePrompt()` | `--regenerate {번호}` 재생성 → VQA 점수 개선 확인 |
| 정탐-한계 | 특정 카테고리에서 모델 점수가 고착 (키워드 DB 한계) | — | IL 기록 + 해당 카테고리 게이트 하향 |

**IC (이미지 맥락 검증)** — Step 2.5/6-3 COM 비교 시 실행:
| 판정 | 기준 | 수정 대상 | 재검증 |
|------|------|----------|--------|
| 오탐 | 이미지가 맥락에 맞는데 IC 판정이 FAIL | IC 판정 기준 자체를 문서에서 수정 | 수정된 기준으로 해당 이미지 재판정 |
| 정탐-수정 (프롬프트) | 프롬프트가 슬라이드 맥락과 안 맞음 | `plan-skill/SKILL.md` NanoBanana 태그 규칙 | 프롬프트 수정 + 재생성 + IC 재판정 |
| 정탐-수정 (품질) | 대비 부족, 비율 왜곡, 해상도 저하 | `nanoBanana-guide.md` + HTML CSS (오버레이/shadow) | 이미지 재생성 또는 HTML 보정 후 COM 재확인 |
| 정탐-한계 | Gemini가 특정 주제를 정확히 생성 불가 | — | IL 기록 + 추상 메타포로 대체 (회피 규칙) |

#### 에러 발생 시 → CLAUDE.md §공통 절차 실행

모든 파이프라인(IP/IV/VQA/IC)에서 ERROR/WARN/FAIL 발견 시:
1. **3분류 판정** (위 테이블 참조)
2. **오탐/정탐-수정** → CLAUDE.md §공통 절차 A~I 체크리스트 생성 + 실행
3. **정탐-한계** → CLAUDE.md §공통 절차 간소화 A~D 체크리스트 생성 + 실행

**완료 게이트**: 전부 `[x]` 전까지 다음 이미지/슬라이드/Step 진행 금지.

### 이미지 품질 게이트 (생성 완료 후 필수)

IP/IV 자동 검수를 통과한 이미지도 **Read 도구로 직접 열어** 전수 시각 검사한다 (Opus 멀티모달).

#### 검사 절차

1. `slide-outline.md`를 열어 NanoBanana 태그가 있는 슬라이드 목록 + 각 슬라이드의 Meta(Topic, Audience, Tone), Title, Key Message를 메모
2. `assets/` 이미지를 `Read`로 하나씩 열어 아래 5개 기준으로 PASS/FAIL 판정
3. FAIL 이미지 → 삭제 + 프롬프트 수정하여 재생성 또는 placeholder 처리

#### 기준 1 — 가짜 데이터 인포그래픽 검출

이미지 내 차트/그래프/표/캘린더 + 의미 없는 숫자/텍스트가 보이면 **FAIL**.
→ 해당 슬라이드는 HTML/CSS로 데이터 시각화 직접 구현.

```
FAIL: 이미지 안에 막대 그래프가 있고 "45%", "Revenue" 등 AI가 생성한 가짜 라벨이 보임
PASS: 창고 내부 사진 — 숫자/텍스트 없는 순수 사진
```

#### 기준 2 — 한글 텍스트 검출

AI 이미지 내 한글이 깨져서 출력된 경우 **FAIL**.
→ 영문 프롬프트로 재생성 또는 텍스트 없는 이미지로 교체.

```
FAIL: 이미지 안에 "물류" 같은 한글이 깨진 글자(글리프 왜곡)로 보임
PASS: 텍스트가 전혀 없는 사진 / 영문 간판이 자연스럽게 포함된 사진
```

#### 기준 3 — 허용 유형 확인

사진(stock photo), 아이콘(SVG), 추상적 일러스트(데이터/텍스트 없는 것), 실제 스크린샷만 허용. 그 외 **FAIL**.

```
FAIL: 3D 렌더링 인포그래픽, 만화 스타일 캐릭터, 클립아트
PASS: 항공 촬영 물류 허브 사진, 추상적 기하학 패턴
```

#### 기준 4 — 아웃라인 맥락 대조 (5개 하위 체크)

각 이미지를 해당 슬라이드의 아웃라인과 대조하여 아래 5개 항목을 판정한다. **하나라도 FAIL이면 이미지 FAIL**.

**(4-A) 업종/산업 일치**
- outline Meta의 Topic에서 업종 키워드를 추출 (예: "물류업", "금융", "IT", "제조")
- 이미지의 주요 피사체가 해당 업종과 관련 있는지 판정

**(4-B) 슬라이드 주제 일치**
- 해당 슬라이드의 Title + Key Message에서 핵심 주제어를 추출
- 이미지가 해당 주제와 시각적으로 연결되는지 판정
- 판정 기준: "이 이미지를 보고 슬라이드 주제를 유추할 수 있는가?"

**(4-C) 톤/분위기 일치**
- outline Meta의 Tone/Mood와 이미지 분위기 대조
- NanoBanana 프롬프트의 분위기 키워드와 실제 이미지 일치 여부

**(4-D) NanoBanana 프롬프트 피사체 일치**
- NanoBanana 태그에 명시된 피사체(사물/장소/인물)가 이미지에 실제로 존재하는지 판정

**(4-E) 데이터 슬라이드 장식 이미지 과잉**
- 슬라이드 Type이 `Data Table`, `Formula`, `Process`, `Checklist`, `Timeline Table`인데 NanoBanana 이미지가 배정된 경우 → **경고** (WARN)

#### 기준 5 — NanoBanana 프롬프트 규칙 준수

`nanoBanana-guide.md`의 프롬프트 규칙을 이미지 결과물에서 역검증:

| 규칙 | 검증 방법 | FAIL 조건 |
|------|---------|----------|
| 텍스트 없는 이미지 | 기준 1, 2와 동일 | 이미지 내 텍스트 존재 |
| 분할 레이아웃에 16:9 금지 | NanoBanana 비율 힌트 확인 | `[3:4]` 힌트인데 16:9 비율 이미지 |
| 전체 배경: muted/desaturated | 이미지 채도 판정 | 풀블리드 배경용인데 선명하고 채도 높은 이미지 |
| 밝기 제한 | NanoBanana 프롬프트 밝기 키워드 대조 | "dark moody" 지정인데 밝은 이미지 |

#### 판정 결과 처리

| 판정 | 행동 |
|------|------|
| 모든 기준 PASS | 이미지 유지, Step 2 진행 |
| 기준 1~3 FAIL | 즉시 삭제 + 재생성 (프롬프트 수정) |
| 기준 4 FAIL (맥락 불일치) | 삭제 + 프롬프트에 구체적 피사체/업종/톤 키워드 추가하여 재생성 |
| 기준 4-E WARN | 아웃라인의 NanoBanana 태그 자체를 `없음`으로 변경 검토 |
| 기준 5 FAIL | 프롬프트 비율/밝기 수정 후 재생성 |
| 재생성 2회 후에도 FAIL | placeholder 처리 + 사용자에게 보고 |

### 실패 시

- 개별 이미지 실패는 나머지에 영향 없음 (계속 진행)
- 실패한 슬라이드는 Step 2에서 placeholder로 처리
- 스크립트가 실패 슬라이드 재생성 명령어를 자동 출력

**이미지 전부 미준비 시**: `--dry`로 태그 확인만 하고 placeholder로 진행 가능
