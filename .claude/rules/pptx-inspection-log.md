# PPTX 검사 기록

Step 2(HTML 생성), Step 2.5(PPT MCP 사전 검증), Step 6(PPTX 생성) 시작 전 반드시 이 파일을 읽고, 기존 이슈 패턴을 반영한다.
검사 Phase 완료 후 발견/수정 내용을 이 파일에 추가한다.

### 패턴 번호 규칙 (Append-Only)

- 새 패턴은 **마지막 번호 + 1**로 추가 (현재 마지막: #20)
- 기존 번호를 재배정하거나 중간에 삽입 금지 — 다른 문서(`presentation-flow.md`, `design-skill/SKILL.md` 등)에서 번호로 참조하므로 변경 시 참조 깨짐
- 해결된 패턴도 번호를 유지하고 삭제하지 않음 (히스토리 보존)

---

## 이슈 패턴

### 1. CJK 텍스트 줄바꿈 (한글 제목/키워드 밀림)

**증상**: PowerPoint에서 한글 텍스트가 Chrome 대비 15~20% 넓게 렌더링되어 텍스트 박스를 넘침
**영향 범위**: 제목(h1), 배지 번호, 짧은 키워드(2~3글자), 한 줄 문장
**근본 원인**: Chrome과 PowerPoint의 한글 글리프 폭 메트릭 차이
**수정 (html2pptx.cjs)**: CJK 비율 30%+ 텍스트에 폭 보정 20% (단일행) / 15% (다중행) 적용, 단일행 CJK에 `fit: "shrink"` 안전망
**HTML 작성 시 예방**:
- 제목 텍스트 박스에 충분한 여유 폭 확보 (최소 20% 여백)
- 2~3글자 키워드가 작은 영역에 배치되면 font-size를 1~2px 줄이기
- 긴 한 줄 문장은 줄바꿈 가능하도록 높이 여유 확보

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-12 | noahs-ark | 2 | "목차" 2글자가 "목/차"로 줄바꿈 | html2pptx.cjs CJK 폭 보정 8%→20% |
| 2026-03-12 | noahs-ark | 4 | "하나님의 계획" 제목 줄바꿈 | 동일 |
| 2026-03-12 | noahs-ark | 9 | "비둘기와 올리브 잎" 줄바꿈 | 동일 |
| 2026-03-12 | noahs-ark | 10 | "방주에서 나왔어요" 줄바꿈 | 동일 |
| 2026-03-12 | noahs-ark | 11 | "무지개 약속" 줄바꿈 | 동일 |
| 2026-03-12 | noahs-ark | 12 | "순종/사랑/약속" 큰 글자 각각 줄바꿈 | 동일 |

### 2. 초록/강조 바 텍스트 잘림

**증상**: 배경색 있는 바(div) 안의 텍스트가 높이 부족으로 하단 잘림
**영향 범위**: highlight-bar, CTA 바 등 1줄 텍스트 + 배경색 조합
**수정**: 텍스트 박스 높이 보정 15% (기존 10%), CJK 폭 보정으로 줄바꿈 방지

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-12 | noahs-ark | 4 | "노아는 이상하다고 생각했지만..." 2줄 잘림 | html2pptx.cjs CJK 폭 보정 + 높이 보정 |

### 3. 배지 번호 줄바꿈

**증상**: 작은 roundRect 안의 "01"~"08" 번호가 "0/1"처럼 줄바꿈
**영향 범위**: section-badge, step-number 등 작은 원/사각형 내 숫자
**근본 원인**: 텍스트 박스 폭이 2자리 숫자를 수용하기에 부족
**수정**: CJK 감지와 무관하게 폭 보정 기본값(8%)이 적용되지만, 숫자+볼드 조합에서도 부족할 수 있음

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-12 | noahs-ark | 2,3 | "01" 등 번호가 줄바꿈 | CJK 폭 보정으로 간접 해결 |
| 2026-03-12 | sailing-ships | 2 | "01" 배지 줄바꿈 (min-width: 36pt→40pt도 부족) | PowerPoint에서 정상 가능성 |

### 4. 변환 전 HTML 수정 패턴 (PPTX 변환 에러 → HTML 수정 필요)

**증상**: convert-native.mjs가 특정 HTML 패턴에서 에러를 반환하여 변환 전 HTML 수정이 필요
**영향 범위**: 배경 이미지를 사용하는 모든 슬라이드
**HTML 작성 시 예방 규칙**:

#### 4-1. DIV의 linear-gradient 배경 → 에러 발생하지 않도록 수정 완료
- html2pptx.cjs가 DIV의 `backgroundImage`에 `url()` 포함 시에만 에러 발생하도록 수정 (gradient는 허용)
- **수정 전**: `linear-gradient`도 에러 → 오버레이 div 사용 불가
- **수정 후**: `url()` 패턴만 에러 → gradient 오버레이 자유롭게 사용 가능

#### 4-2. 이미지 경로 file:/// 이중화 (Windows)
- `file:///D:/path` → `file://` 제거 → `/D:/path` (앞에 `/` 남아 이중 경로)
- **수정**: `file:///` 8글자 제거 + Windows 드라이브 감지로 올바른 `D:/path` 변환

#### 4-3. 오버플로 방지 — 이미지 height: 100%
- `<img style="height: 100%">`가 body 높이와 같으면 0.5" 하단 마진 침범
- **예방**: 이미지가 슬라이드 전체 높이를 차지하면 `height: 369pt` (405pt - 36pt 마진) 사용
- 또는 grid/flex 레이아웃 내 이미지는 max-height로 제한

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-12 | sailing-ships | 1,5,6 | DIV gradient overlay 에러 | html2pptx.cjs: url() 패턴만 에러 발생하도록 수정 |
| 2026-03-12 | sailing-ships | 3 | 이미지 경로 `/D:/D:/...` 이중화 | html2pptx.cjs: file:/// 파싱 Windows 대응 |
| 2026-03-12 | sailing-ships | 7 | 37.5pt→2.3pt 오버플로 | 패딩/gap 축소 + 이미지 height 고정 |

### 6. 카드/박스 내 텍스트 오버플로 (PowerPoint 전용)

**증상**: PowerPoint에서 텍스트가 카드(roundRect) 경계를 넘침
**영향 범위**: 배경색 있는 카드 안의 굵은 텍스트, 특히 한글+연도/숫자 조합 (예: "빅토리아호 (1519~1522)")
**근본 원인**: PowerPoint가 Chrome보다 텍스트를 넓게 렌더링 + 카드 padding이 부족
**HTML 작성 시 예방**:
- 카드 내 텍스트 font-size를 11pt 이하로 제한 (12pt는 위험)
- 한글+괄호+숫자 조합은 font-size를 1~2pt 추가 축소
- 카드 padding을 최소 16pt 확보 + 텍스트 길이 대비 카드 폭 30% 여유
- `max-width` 제한이 있는 컨테이너 내 카드는 특히 주의

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | sailing-ships | 6 | "빅토리아호 (1519~1522)" 등 카드 텍스트 경계 초과 | PowerPoint MCP 검사에서 확인 |

### 7. 이미지 밝기로 인한 텍스트 가독성 저하

**증상**: 배경 이미지가 밝아서 위에 겹쳐진 텍스트가 안 보임. 병렬 레이아웃에서도 밝은 이미지가 인접 텍스트 가독성 저하
**영향 범위**: ① 전체 배경 이미지 + gradient 오버레이 + 텍스트 조합 ② 이미지+텍스트 병렬 레이아웃
**근본 원인**: NanoBanana가 밝은 이미지를 생성하는데, gradient 오버레이 불투명도가 부족하여 PPTX에서 텍스트가 배경에 묻힘
**예방 단계**:
- **Step 1.5 (NanoBanana 프롬프트)**: 텍스트 위에 배치될 배경 이미지에 `"dark moody atmosphere"`, `"muted, desaturated tones"`, `"low-key lighting"` 키워드 필수
- **Step 2 (HTML 생성)**:
  - 전체 배경 이미지 + 텍스트 오버레이 시: gradient 최소 불투명도 **0.7 이상** (상단), **0.9 이상** (하단/텍스트 영역)
  - 병렬 레이아웃: 밝은 이미지 옆 텍스트에 반투명 오버레이 또는 텍스트 그림자 추가
  - `text-shadow: 0 2px 8px rgba(0,0,0,0.5)` 제목에 필수 적용
- **Step 6-3 (검사)**: 이미지-텍스트 겹침 슬라이드의 대비 시각 확인 (특히 마지막 장/표지)

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | sailing-ships | 7 | 프로이센호 이미지(밝은 바다/하늘)가 왼쪽 텍스트 가독성 저하 | NanoBanana 프롬프트에 밝기 제한 필요 |
| 2026-03-13 | triassic-dinosaurs | 10 | 쥐라기 숲 배경이 밝아 제목+카드 텍스트 전체 안 보임 | gradient 오버레이 강화: 상단 0.3→0.7, 중간 0.6→0.85, 하단 0.9→0.95 |

### 9. CJK 폭 보정이 부모 컨테이너를 넘침 (텍스트 박스 오버플로)

**증상**: 카드/박스 안의 텍스트가 부모 배경 도형 경계를 넘어 오른쪽으로 삐져나옴
**영향 범위**: 배경색 있는 div 안의 모든 텍스트 요소 (특히 CJK 텍스트 + padding이 있는 카드)
**근본 원인**: html2pptx.cjs의 CJK 폭 보정(+8~20%)이 부모 컨테이너 경계를 무시하고 텍스트 박스를 확장
**예시**: 카드 div width=308pt, 텍스트 Chrome 렌더링 300pt → CJK 보정 후 332pt → 카드보다 41pt 넘침
**수정 (html2pptx.cjs)**: CJK 폭 보정 후 부모 shape 경계에 클램핑 로직 추가. 텍스트의 원래 위치가 포함된 가장 작은 shape를 찾아 오른쪽/왼쪽 경계 클램핑
**HTML 작성 시 예방**: 이 수정으로 변환기가 자동 처리하므로 HTML 측 예방 불필요

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | triassic-dinosaurs-v2 | 3 | "바다 생물의95%..." 바, 원인/회복 카드 텍스트가 배경보다 39pt 넘침 | html2pptx.cjs 부모 shape 클램핑 |
| 2026-03-13 | triassic-dinosaurs-v2 | 8 | 비밀무기 1/2/3 카드 텍스트가 카드보다 41pt 넘침 | 동일 |

### 8. 에디터 assets 서빙 미지원

**증상**: 비주얼 에디터에서 `assets/` 상대 경로 이미지가 깨짐 (404)
**근본 원인**: editor-server.js에 슬라이드 디렉토리의 assets/ 정적 라우트 미설정
**수정**: `/assets/` + `/slides/assets/` 두 경로 모두 정적 서빙 추가
**에디터 실행 시 GEMINI_API_KEY 필수**: NanoBanana 이미지 수정을 위해 환경변수 전달 필수

**발생 사례**:
| 날짜 | 프레젠테이션 | 이슈 | 수정 |
|------|-------------|------|------|
| 2026-03-12 | sailing-ships | 에디터에서 모든 이미지 깨짐 | editor-server.js에 express.static 추가 |
| 2026-03-12 | sailing-ships | Claude 서브프로세스에서 GEMINI_API_KEY 없음 | 에디터 실행 시 환경변수 전달 필수 |

### 10. 슬라이드 전체 콘텐츠 하단 오버플로 (body 405pt 초과)

**증상**: 슬라이드 콘텐츠가 body 하단(405pt)을 넘어 잘림. 브라우저 뷰어에서는 스크롤로 보이지만 PPTX에서는 잘려 사라짐
**영향 범위**: 항목이 많은 슬라이드 — 4개+ 카드 그리드, 5개+ 리스트 아이템, 다단 레이아웃
**근본 원인**: body padding + 제목 영역 + gap + 아이템 padding 누적이 405pt를 초과
**수정 패턴**: padding 축소 (40pt→32pt), gap 축소 (14pt→10pt, 10pt→7pt), 아이템 내부 padding 축소 (18pt→14pt, 14pt→10pt), font-size 축소 (13pt→12pt, 12pt→10pt, 9pt 유지)
**HTML 작성 시 예방**:
- 항목 4개+ 그리드: body padding 최대 32pt, gap 최대 10pt
- 항목 5개+ 리스트: body padding 최대 32pt, 아이템 간 gap 최대 7pt, 아이템 내부 padding 최대 10pt
- 제목 + key-msg + 그리드 조합: 제목 margin-bottom 4pt 이하, key-msg margin-bottom 12pt 이하
- 콘텐츠 높이 사전 계산: body padding(상+하) + 제목(~30pt) + 메시지(~18pt) + (아이템 높이 × 수) + (gap × (수-1)) ≤ 405pt
- 여유분 없으면 font-size를 1~2pt 줄여 아이템 높이 축소

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | manufacturing-kpi-report | 3 | PQCD 4카드 그리드 하단 잘림 (padding 40pt + gap 14pt + card padding 18pt 누적) | padding 40→32pt, gap 14→10pt, card padding 18→14pt, card-title 13→12pt |
| 2026-03-13 | manufacturing-kpi-report | 9 | 5개 체크리스트 하단 5번째 항목 잘림 (padding 40pt + gap 10pt + item padding 14pt) | padding 40→32pt, gap 10→7pt, item padding 14→10pt, check-title 13→12pt, check-desc 10→9pt |

### 11. 리프 DIV 텍스트 누락 (PPTX에 텍스트 미렌더링)

**증상**: 카드/박스 내부의 모든 본문 텍스트가 PPTX에서 완전히 사라짐. 제목(h1)만 보이고 나머지 텍스트 전부 누락
**영향 범위**: `<div><span>텍스트</span></div>` 패턴으로 작성된 모든 텍스트 요소
**근본 원인**: html2pptx.cjs가 `textTags = ['P', 'H1'~'H6', 'UL', 'OL', 'LI']`만 텍스트로 인식. `<div>` 안의 텍스트는 bg/border가 없으면 shape으로도, text로도 처리되지 않고 건너뜀
**수정 (html2pptx.cjs)**: 리프 DIV 감지 로직 추가 — `<div>` 안에 블록 자식(div, p, h1 등)이 없고 textContent가 있으면 `<p>`처럼 텍스트 요소로 처리
**HTML 작성 시 참고**: 이 수정 후에는 `<div><span>텍스트</span></div>` 패턴도 정상 변환됨. `<p>` 래핑 불필요

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | manufacturing-kpi-report | 전체(1-10) | 제목만 보이고 카드/리스트/배지 텍스트 전부 누락 | html2pptx.cjs에 리프 DIV → 텍스트 요소 처리 로직 추가 |

### 12. 배경 있는 리프 DIV의 span 텍스트 누락 (Shape 내부 텍스트 미삽입)

**증상**: `<div style="background:..."><span>텍스트</span></div>` 패턴에서 배경 shape은 렌더링되지만 내부 텍스트가 완전히 사라짐. 아이콘 박스, 배지, 태그 등 작은 shape 내부 글자/숫자가 비어 보임
**영향 범위**: 배경(background) 또는 테두리(border)가 있는 div가 블록 자식(div, p, h1 등) 없이 직접 span/b/i/em 등 인라인 요소만 포함하는 모든 경우
**근본 원인**: html2pptx.cjs의 shape 추출 로직(line 937-990)에서 배경 있는 div를 shape으로 변환 시 `text: ''`(빈 문자열)로 설정하고 return. 내부 `<span>`은 textTags에 포함되지 않아 별도 텍스트 요소로도 처리되지 않음. 패턴 #11의 리프 DIV 처리는 배경 없는 div만 대상이므로 이 케이스를 놓침
**수정 (html2pptx.cjs)**: shape 추출 시 리프 div 감지 추가 — 블록 자식이 없고 textContent가 있으면 span/b/i/em에서 텍스트 + 스타일(fontSize, fontFace, color, bold, italic) 추출 → shape의 text에 PptxGenJS 포맷 배열로 삽입. flex align-items/justify-content 감지하여 shape 내 텍스트 정렬(align/valign)도 적용. 자식 요소는 processed에 추가하여 이중 렌더링 방지
**HTML 작성 시 참고**: 이 수정 후 `<div style="background:..."><span>텍스트</span></div>` 패턴이 정상 변환됨

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | manufacturing-kpi-report | 1 | "Executive Report" 태그 텍스트 미표시 | html2pptx.cjs 리프 shape 텍스트 추출 |
| 2026-03-13 | manufacturing-kpi-report | 2 | detail-icon 숫자 1-4 미표시 | 동일 |
| 2026-03-13 | manufacturing-kpi-report | 3 | card-icon P/Q/C/D 글자 미표시 | 동일 |
| 2026-03-13 | manufacturing-kpi-report | 4 | loss-tag 6개 텍스트 전부 미표시 | 동일 |
| 2026-03-13 | manufacturing-kpi-report | 8 | bottom-icon ↻ 미표시 | 동일 |
| 2026-03-13 | manufacturing-kpi-report | 9 | check-num 번호 1-5 미표시 | 동일 |
| 2026-03-13 | manufacturing-kpi-report | 10 | takeaway-num 번호 1-4 미표시 | 동일 |

### 13. Flex 레이아웃 이미지+텍스트 분할 시 오버플로 (box-sizing 누락)

**증상**: 이미지+텍스트 좌우 분할 레이아웃에서 이미지가 슬라이드 오른쪽 경계(720pt)를 넘어 삐져나옴
**영향 범위**: `flex: 0 0 50~55%` (이미지) + `flex: 1` (텍스트) 병렬 레이아웃의 모든 슬라이드
**근본 원인**: CSS flex에서 `flex: 1` 텍스트 div의 padding이 `content-box` (기본값)이면 padding이 flex 할당 폭 바깥으로 추가됨. 예: 이미지 55%=396pt + 텍스트 flex:1=324pt + padding 46pt = 370pt → 총 766pt > 720pt
**수정 (HTML)**: 3가지 동시 적용 — ① 텍스트 div에 `box-sizing: border-box; min-width: 0;` ② flex 컨테이너 div에 `overflow: hidden; max-width: 720pt;` ③ 이미지 div에 `min-width: 0;`
**HTML 작성 시 예방**:
- 이미지+텍스트 병렬 레이아웃의 `flex: 1` div에 반드시 `box-sizing: border-box; min-width: 0;` 적용
- flex 컨테이너(display: flex 부모) div에 `overflow: hidden;` 적용 (body의 overflow: hidden만으로는 부족)
- 이미지 div에 `min-width: 0;` 적용 (이미지 intrinsic size가 flex-basis를 넘지 않도록)
- `flex: 0 0 N%` 이미지 div에도 `overflow: hidden` 적용

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | mesozoic-dinosaurs | 3,4,5,6,8 | 이미지가 720pt 경계 밖으로 넘침 | 텍스트 div에 box-sizing: border-box; min-width: 0 추가 |
| 2026-03-13 | mesozoic-dinosaurs | 3,4,5,6,8,9,10,11,12,13,15 | box-sizing만으로 브라우저 에디터에서 오버플로 미해소 | flex 컨테이너에 overflow: hidden + max-width: 720pt, 이미지 div에 min-width: 0 추가 |

### 14. CSS linear-gradient 배경 + 흰색 텍스트 → PPTX에서 텍스트 안 보임

**증상**: `linear-gradient` 배경을 가진 div 안의 흰색(`#FFFFFF`) 텍스트가 PPTX에서 보이지 않음. 배경색이 사라지고 흰색 텍스트만 남아 밝은 배경에 묻힘
**영향 범위**: `background: linear-gradient(...)` + `color: #FFFFFF` 조합의 모든 요소 (배너, 헤더 바, CTA 등)
**근본 원인**: html2pptx.cjs가 CSS `linear-gradient`를 PPTX shape fill로 변환하지 않음. gradient는 에러를 발생시키지 않지만(패턴 #4-1), 실제 배경색으로 렌더링되지도 않음. design-skill에도 "CSS gradients: Not supported in PowerPoint conversion" 경고가 있지만 슬라이드 생성 시 위반
**수정 (HTML)**: `linear-gradient(...)` → 단색 `background: #주색상`으로 교체
**HTML 작성 시 예방**:
- **`linear-gradient` + 흰색 텍스트 조합 절대 금지** — PPTX에서 텍스트가 완전히 사라짐
- gradient가 필요하면 단색 배경으로 대체 (gradient의 시작 색상 사용)
- 이 규칙은 `rgba()` 배경에도 적용 — `rgba(255,255,255,0.2)` 같은 반투명도 PPTX에서 예측 불가
**PPT MCP 검사 시 주의**: 프리뷰 썸네일에서 텍스트가 "연하게 보이면" 실제 PowerPoint에서는 안 보일 가능성 높음. 흰색 텍스트가 있는 슬라이드는 배경 shape의 fill 유무를 반드시 확인

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | mesozoic-dinosaurs | 7 | 퀴즈 배너 `linear-gradient(135deg, #3B82F6, #6366F1)` + 흰색 제목/부제 → PPTX에서 안 보임 | `background: #3B82F6` 단색으로 교체 |
| 2026-03-13 | mesozoic-dinosaurs | 14 | 퀴즈 배너 `linear-gradient(135deg, #F97316, #F59E0B)` + 흰색 제목 → 동일 | `background: #F97316` 단색으로 교체 |

### 15. 이미지 비율 불일치 (Sharp 후처리 폴백)

**증상**: NanoBanana `[3:4]` 비율 힌트로 생성된 이미지가 1920×1080 (16:9)으로 리사이즈되어 찌그러짐. 슬라이드의 세로 이미지 컨테이너에 가로 이미지가 들어가 비율 왜곡
**영향 범위**: Sharp `dimensions` 맵에 미등록된 비율 힌트를 사용하는 모든 이미지
**근본 원인**: `generate-images.mjs`의 `optimizeImage()` + 단일 이미지 모드의 `dimensions` 맵에 `"3:4"` 항목이 없어 `dimensions["16:9"]`로 silent fallback
**수정 (generate-images.mjs)**: ① dimensions 맵에 `3:4`, `2:3` 추가 (총 8개 비율) ② 미등록 비율 시 `console.warn` 경고 + 원본 비율 유지 (16:9 폴백 제거) ③ 생성 완료 시 `{width}×{height} ({ratio})` 해상도 로그 자동 출력
**HTML 작성 시 예방**: 이미지 생성 로그에서 해상도와 비율 힌트 불일치 확인. 불일치 시 `dimensions` 맵 업데이트 필요

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | mesozoic-dinosaurs | 3,4,8 | `[3:4]` 요청 → 1920×1080 출력 (16:9 폴백) → 세로 컨테이너에 가로 이미지 | generate-images.mjs dimensions 맵에 3:4 추가 + 미등록 비율 경고 |

### 16. WCAG 대비율 미달 (프로그래매틱 감지)

**증상**: 텍스트 색상과 배경 색상의 WCAG 대비율이 낮아 PPTX에서 텍스트가 보이지 않거나 읽기 어려움
**영향 범위**: 모든 텍스트 요소 — gradient fallback 실패(패턴 #14)뿐 아니라, 밝은 배경+밝은 텍스트, 어두운 배경+어두운 텍스트 등 모든 저대비 조합
**감지 방법**:
- **빌드타임**: `html2pptx.cjs`가 변환 시 WCAG 대비율을 자동 계산하여 경고 출력. `convert-native.mjs`가 전체 슬라이드 경고를 summary로 출력
- **PPT MCP**: `ppt_get_shape_info` (fill color) + `ppt_get_text` (text color)로 프로그래매틱 확인
**임계값**:
- < 1.5:1 → **ERROR** (불가시 — 텍스트를 읽을 수 없음)
- < 4.5:1 → **WARN** (WCAG AA 미달 — 읽기 어려움)
**근본 원인**: CSS `linear-gradient`가 PPTX에서 단색 fallback으로 변환되지만, fallback 색상 추출 실패 시 배경이 사라짐. 또는 디자인 시 배경-텍스트 대비를 고려하지 않은 경우
**수정**: HTML에서 `linear-gradient` → 단색 `background`로 교체, 또는 텍스트 색상을 배경과 충분한 대비가 있는 색으로 변경
**HTML 작성 시 예방**: `linear-gradient` + 흰색 텍스트 절대 금지 (패턴 #14). 모든 텍스트의 배경 대비를 의식적으로 확인

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | mesozoic-dinosaurs | 16 | 하단 박스 `linear-gradient(135deg, #3B82F6, #10B981)` + `color: #FFFFFF` → gradient fallback 후에도 PPTX에서 흰 배경에 흰 텍스트 | `background: #3B82F6` 단색으로 교체 |

### 17. 테이블 컬럼 정렬 틀어짐 (CJK 폭 보정 + center-align 오프셋)

**증상**: 테이블(flex 또는 CSS grid)에서 PPTX 컬럼이 행마다 어긋남. 헤더(배경 있음)와 바디 셀(배경 없음)의 수직 정렬이 깨짐
**영향 범위**: 배경 있는 셀(shape)과 배경 없는 셀(text)이 혼재하는 모든 테이블형 레이아웃
**근본 원인 (2단계)**:
1. **CJK 폭 보정 차등**: 배경 있는 셀은 shape으로 변환되어 원본 위치 유지. 배경 없는 셀은 text로 변환되어 CJK 비율에 따라 +8~20% 폭 보정 → 같은 컬럼인데 행마다 x/w가 달라짐
2. **center-align 오프셋**: `text-align: center`인 셀은 Chrome이 텍스트 바운딩 박스를 셀 중앙에 배치 → 텍스트 x ≠ 셀 x. Shape의 x는 셀 전체 위치인데 텍스트의 x는 바운딩 박스 위치 → 정확 좌표 비교(±3pt)로는 매칭 불가
**수정 (html2pptx.cjs)**: `addElements()`에 3단계 **컬럼 정렬 후처리** 추가. 텍스트 요소를 즉시 addText()하지 않고 `pendingText[]`에 수집한 뒤:
- **Phase 1**: 배경 있는 shape(내장 텍스트 포함)의 (x, w) 좌표를 "컬럼 앵커"로 수집. **confirmed table columns** (ySet.size >= 2)에서만 Y 범위(tableYMin~tableYMax) 계산 — 배지/히어로 등 non-table shape이 Y 범위를 오염시키지 않도록 함
- **Phase 2 (Containment Snapping)**: 4가지 조건을 **모두** 만족해야 스냅:
  1. **confirmed column** (ySet.size >= 2) — 단일 Y shape은 테이블이 아님
  2. **수직 범위 내** — 텍스트 Y가 confirmed columns의 Y 범위 안에 있어야 함 (Y_TOL=0, strict)
  3. **폭 유사** — 텍스트 원래 폭(origW) ≤ 컬럼 폭 × 1.5
  4. **높이 유사** — 텍스트 높이 ≤ max shape cell height × 2.0 (히어로 숫자 제외)
  스냅 시 x/w를 shape 컬럼의 x/w로 교체 + `fit:'shrink'` + `margin:[0,0,0,0]` (패턴 #19 참조)
- **Phase 3 (Peer Normalization)**: **테이블이 있는 슬라이드에서만** 실행. 테이블 Y 범위 내 unsnapped 텍스트만 대상. 동일 x(±3pt) 그룹 내 3개+ & 다중 y → 그룹 내 최소 x / 최대 right로 통일. **테이블 없는 슬라이드에서는 Phase 3 비활성** (패턴 #20 참조)

**⚠️ HTML 테이블 작성 필수 규칙 (이 패턴 재발 방지)**:
1. **CSS grid 사용 필수** — `display: grid; grid-template-columns: 고정pt 고정pt ...` (flex: 1 대신). 고정 컬럼 폭은 Chrome과 PowerPoint 모두 동일 위치 보장
2. **교차 행 배경 적용 권장** — `.alt { background: #F5F5F4 }` 등으로 짝수 행에 배경을 주면 해당 셀이 shape으로 변환되어 컬럼 앵커 역할. 배경 없는 셀만 있는 컬럼은 앵커가 없어 snapping 불가
3. **헤더 행에 반드시 배경 적용** — 헤더 배경이 모든 컬럼의 기준 앵커가 됨
4. **셀 내 텍스트는 `<span>` 래핑** — `<div class="cell"><span>텍스트</span></div>` 패턴. div가 배경 있으면 shape+텍스트, 없으면 leaf div→텍스트 요소로 처리

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | coupang-investment-report | 10 | CSS grid 4열 비교표 — 배경 없는 셀이 CJK+center 보정으로 컬럼 어긋남 | html2pptx.cjs: containment snapping (텍스트 중심점 기반 매칭) |
| 2026-03-13 | coupang-investment-report | 7 | 1차 containment snapping이 제목까지 스냅 → 제목 레이아웃 깨짐 | Y 범위 체크 + 폭 비교 체크 추가로 테이블 셀만 스냅 |
| 2026-03-13 | coupang-investment-report | 10 | 테이블 1열(비교 항목) 좌측 정렬 미세 차이 — inset vs margin 불일치 | Phase 2 스냅 시 margin:[0,0,0,0] 적용 (패턴 #19) |
| 2026-03-13 | coupang-investment-report | 10 | "20.7%" + "1위 역전" 겹침 — tableYMin이 비테이블 shape(배지)에서 계산되어 hero 요소가 테이블 범위 안으로 포함 | Phase 1: tableYMin/tableYMax를 confirmed columns에서만 계산 |

### 18. 이미지+텍스트 50% 분할 레이아웃에서 제목 잘림

**증상**: 좌우 50:50 이미지+텍스트 분할에서 긴 한글 제목이 텍스트 영역 오른쪽 경계를 넘어 잘림
**영향 범위**: `flex: 0 0 50%` (이미지) + `flex: 1` (텍스트) 병렬 레이아웃의 긴 제목
**근본 원인**: 텍스트 영역 실제 폭 ≈ 316pt (360pt - padding 44pt). 한글 16pt × 25자 ≈ 280pt → CJK +20% 보정 후 ~336pt > 316pt → 오른쪽 잘림
**수정 (HTML)**: 제목 font-size 16pt → 14pt로 축소
**HTML 작성 시 예방**: 50% 분할 레이아웃의 텍스트 영역에서 한글 제목은 14pt 이하 사용. 15자 이상 한글 제목은 font-size를 1~2pt 추가 축소하거나 줄바꿈 허용

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | coupang-investment-report | 11 | "$1.2B 바우처와 대만 투자 손실이 2026년 이익을 압박한다" 제목 오른쪽 잘림 | font-size 16pt → 14pt |

### 19. 테이블 셀 내부 패딩 불일치 (PptxGenJS `inset` 무효 속성)

**증상**: 같은 테이블 컬럼인데 배경 있는 셀(shape)과 배경 없는 셀(text)의 좌측 정렬이 ~3.6pt 어긋남. 확대하면 보이지만 MCP 프리뷰 축소 해상도에서는 감지 불가
**영향 범위**: shape(margin:[0,0,0,0])과 text element가 혼재하는 모든 테이블 레이아웃
**근본 원인**: html2pptx.cjs에서 shape에는 `margin: [0, 0, 0, 0]` (유효), text에는 `inset: 0` (무효)을 설정. **PptxGenJS는 `inset` 속성을 인식하지 않아 silently 무시** → text element에 기본 내부 패딩(~3.6pt/0.05")이 적용되어 shape과 좌측 정렬이 불일치
**수정 (html2pptx.cjs)**: Phase 2 containment snapping에서 스냅된 text element에 `margin: [0, 0, 0, 0]` 적용. 전역 적용 시 제목 등 비테이블 텍스트 레이아웃이 깨지므로 **테이블 셀로 판정된 텍스트에만** 적용
**검사 시 주의**: MCP 프리뷰 썸네일(~960px 폭)에서는 3-4pt 차이를 감지 불가. **테이블이 있는 슬라이드는 `ppt_get_shape_info`로 shape/text의 margin 속성을 프로그래매틱으로 비교**하거나, PowerPoint에서 직접 확대(200%+) 확인 필요

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | coupang-investment-report | 10 | 1열 "비교 항목" 라벨들이 헤더 대비 ~3.6pt 오른쪽으로 밀림 | Phase 2 스냅에 margin:[0,0,0,0] 추가 |

### 20. Phase 3 Peer Normalization이 비테이블 텍스트를 그룹화하여 폭 오버플로

**증상**: 테이블이 없는 슬라이드에서 제목(h1), 히어로 숫자, 캡션, 비교 문구 등이 전부 full width(720pt)로 확장되어 좌측 패딩 밖으로 삐져나옴
**영향 범위**: 테이블이 없고, 같은 X에 3개+ 텍스트 요소가 있는 모든 슬라이드 (대부분의 비테이블 슬라이드)
**근본 원인**: Phase 3 Peer Normalization이 테이블 유무와 무관하게 모든 unsnapped 텍스트를 origX 기준으로 그룹화. 제목+히어로+캡션이 모두 body padding 위치(~32pt)에 있어 하나의 그룹으로 묶임 → CJK 폭 보정으로 확장된 제목의 넓은 width가 전체 그룹에 전파
**수정 (html2pptx.cjs)**: Phase 3을 **테이블이 있는 슬라이드에서만** 실행 (tableColumns.length >= 2). 테이블이 없으면 Phase 3 후보를 빈 배열로 설정하여 normalization 건너뜀

**발생 사례**:
| 날짜 | 프레젠테이션 | 슬라이드 | 이슈 | 수정 |
|------|-------------|---------|------|------|
| 2026-03-13 | coupang-investment-report | 5 | h1 "WOW 회원이 해지하지 않는 이유..." 제목이 left=0, width=720으로 확장 → 배지(left=32) 밖으로 삐져나옴 | Phase 3을 테이블 슬라이드에서만 실행하도록 변경 |

---

## 검사 프로세스 한계 및 개선사항

### MCP 프리뷰 해상도 한계

PPT MCP `ppt_get_slide_preview`는 ~960px 폭의 썸네일을 반환한다. 이 해상도에서 **감지 가능한 최소 차이는 ~8-10pt**. 이하의 미세 차이(3-4pt 패딩, 1-2pt 정렬 오프셋)는 프리뷰만으로 감지 불가.

**대응 전략**:
1. **테이블/그리드 슬라이드는 프리뷰 외 추가 검증 필수**:
   - `ppt_get_shape_info`로 shape과 text element의 x/w/margin 수치 비교
   - 동일 컬럼 내 shape.x와 text.x의 차이가 0.03"(~2pt) 이상이면 이슈로 판정
2. **축소 프리뷰에서 "아마 괜찮을 것" 판단 금지** (기존 패턴 #14 규칙과 동일 적용 범위 확대)
3. **알려진 감지 불가 이슈 목록**: inset/margin 불일치(#19), 미세 CJK 폭 차이(#1 경미 케이스), 소수점 좌표 반올림 차이

---

## 검사 통과 기록

| 날짜 | 프레젠테이션 | 슬라이드 수 | 결과 | 비고 |
|------|-------------|-----------|------|------|
| 2026-03-12 | noahs-ark | 12 | html2pptx.cjs 수정 후 전체 통과 | CJK 폭 보정 적용, 이모지(🕊️) 이모지 렌더링 PowerPoint에서 정상 |
| 2026-03-12 | sailing-ships | 8 | html2pptx.cjs gradient/경로 수정 후 통과 | "01" 배지 줄바꿈 (패턴 #3), NanoBanana 이미지 8장 정상 |
| 2026-03-13 | sailing-ships | 8 | PowerPoint 추가 확인: 슬라이드6 카드 텍스트 밀림, 슬라이드7 이미지 밝기 | 이슈 패턴 #6, #7 신규 등록 |
| 2026-03-13 | triassic-dinosaurs | 10 | 전체 통과 | 슬라이드2 "01" 배지 줄바꿈 (패턴 #3), 차트/이미지/카드 정상, NanoBanana 이미지 10장 정상 |
| 2026-03-13 | triassic-dinosaurs-v2 | 10 | PowerPoint 확인 → 카드 텍스트 오버플로 발견 (패턴 #9) | 슬라이드 3,8에서 텍스트가 카드 밖으로 넘침. html2pptx.cjs에 부모 shape 클램핑 추가하여 수정 |
| 2026-03-13 | triassic-dinosaurs-v2 | 10 | 클램핑 수정 후 재변환 전체 통과 | PowerPoint MCP 프리뷰로 슬라이드 2,3,5,7,8,10 확인. 모든 텍스트가 카드 경계 내 정상 렌더링 |
| 2026-03-13 | manufacturing-kpi-report | 10 | 텍스트 누락 발견 → 수정 후 통과 | 패턴#11: 리프DIV 텍스트 전체 누락 → html2pptx.cjs 리프DIV 처리 추가. 패턴#10: 슬라이드3,9 하단 오버플로. 패턴#4: 슬라이드1,10 배경이미지 변환 에러. PPT MCP로 전체 10장 검사 통과 |
| 2026-03-13 | manufacturing-kpi-report | 10 | 재검사: 패턴#12 발견 → 수정 후 통과 | 배경 있는 리프 div의 span 텍스트 미삽입 (슬라이드 1,2,3,4,8,9,10 총 7장 영향). html2pptx.cjs에 리프 shape 텍스트 추출 + align/valign 적용. PPT MCP 전체 10장 프리뷰 확인 통과 |
| 2026-03-13 | mesozoic-dinosaurs | 16 | 패턴#13 발견 → HTML 수정 후 전체 통과 | flex 병렬 레이아웃 box-sizing 누락으로 이미지 오버플로 (슬라이드 3,4,5,6,8). box-sizing: border-box 추가. PPT MCP 전체 16장 프리뷰 확인 통과 |
| 2026-03-13 | mesozoic-dinosaurs | 16 | 패턴#13 추가 수정 → 전체 통과 | box-sizing만으로 브라우저 에디터 오버플로 미해소 → flex 컨테이너에 overflow: hidden + max-width: 720pt, 이미지 div에 min-width: 0 추가. PPT MCP 전체 11개 수정 슬라이드 프리뷰 확인 통과 |
| 2026-03-13 | mesozoic-dinosaurs | 16 | 패턴#15 수정 후 재변환 전체 통과 | 3:4 이미지 3장 재생성 (1080×1440 정상), generate-images.mjs dimensions 맵 수정. PPT MCP 전체 16장 프리뷰 확인 — 오버플로/잘림/누락 없음 |
| 2026-03-13 | mesozoic-dinosaurs | 16 | 패턴#14 수정 후 재변환 전체 통과 | 슬라이드 7,14 linear-gradient → 단색 배경 교체. PPT MCP 프리뷰 확인 — 제목 텍스트 선명 |
| 2026-03-13 | coupang-investment-report | 14 | 패턴#17 1차 수정 (좌표 비교) 실패 → 2차 수정 (containment snapping) 성공 | 1차: origX vs col.x 비교 → center-align 오프셋으로 매칭 실패. 2차: 텍스트 중심점이 shape 범위 내인지 containment 검사 + x/w를 shape 컬럼으로 교체. PPT MCP 프리뷰 확인 — 테이블 4열 전부 정렬 정상 |
| 2026-03-13 | coupang-investment-report | 14 | 패턴#17 3차 수정 — Y 범위+폭 비교 체크 추가. 패턴#19 margin 적용 | containment snapping이 제목까지 스냅하는 regression 수정. Y 범위·폭 비교·컬럼 수 3중 조건으로 테이블 셀만 정확히 판별. 슬라이드 7 제목 정상, 슬라이드 10 테이블 정렬 정상 |
| 2026-03-13 | coupang-investment-report | 14 | 패턴#17 최종 수정 — tableYMin을 confirmed columns에서만 계산 + Phase 3 비테이블 비활성(#20) | 근본 원인: 배지 shape이 tableYMin을 오염 → hero 요소가 테이블 범위 안으로 포함되어 스냅됨. Phase 3이 비테이블 슬라이드에서 제목을 full width로 확장(#20). `ppt_list_shapes`로 슬라이드 5/7/10 좌표 검증 완료 |
