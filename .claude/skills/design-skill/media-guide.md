# Chart / Diagram / Image Library Guide

design-skill에서 분리된 미디어 가이드. 아웃라인에 차트/다이어그램/이미지가 있을 때만 Read.

---

## 1. Chart.js (Bar / Line / Pie)

### CDN Link
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

### Usage Example
```html
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16pt;">
  <div style="border: 1px solid #e5e5e0; border-radius: 10pt; padding: 10pt;">
    <p style="font-size: 10pt; margin-bottom: 6pt;">Bar Chart</p>
    <canvas id="barChart" style="width: 100%; height: 120pt;"></canvas>
  </div>
  <div style="border: 1px solid #e5e5e0; border-radius: 10pt; padding: 10pt;">
    <p style="font-size: 10pt; margin-bottom: 6pt;">Line Chart</p>
    <canvas id="lineChart" style="width: 100%; height: 120pt;"></canvas>
  </div>
  <div style="border: 1px solid #e5e5e0; border-radius: 10pt; padding: 10pt;">
    <p style="font-size: 10pt; margin-bottom: 6pt;">Pie Chart</p>
    <canvas id="pieChart" style="width: 100%; height: 120pt;"></canvas>
  </div>
</div>

<script>
  const labels = ['Q1', 'Q2', 'Q3', 'Q4'];
  const values = [12, 19, 15, 23];

  new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#1f2937', '#2563eb', '#10b981', '#f59e0b'] }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false }
  });

  new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: { labels, datasets: [{ data: values, borderColor: '#2563eb', backgroundColor: '#93c5fd', fill: true }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false }
  });

  new Chart(document.getElementById('pieChart'), {
    type: 'pie',
    data: { labels, datasets: [{ data: [35, 28, 22, 15], backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#ef4444'] }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false }
  });
</script>
```

Recommendations:
- Use `options.animation: false` for stable PPTX conversion.
- Set explicit width/height on `canvas` elements.

---

## 2. Mermaid (Flowchart / Sequence Diagram)

### CDN Link
```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
```

### Usage Example
```html
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20pt;">
  <div style="border: 1px solid #e5e5e0; border-radius: 10pt; padding: 10pt;">
    <p style="font-size: 10pt; margin-bottom: 6pt;">Flowchart</p>
    <pre class="mermaid">
flowchart LR
  A[Plan] --> B[Design]
  B --> C[Review]
  C --> D[Convert]
    </pre>
  </div>
  <div style="border: 1px solid #e5e5e0; border-radius: 10pt; padding: 10pt;">
    <p style="font-size: 10pt; margin-bottom: 6pt;">Sequence Diagram</p>
    <pre class="mermaid">
sequenceDiagram
  participant U as User
  participant A as Agent
  U->>A: Request slide
  A->>U: Return HTML
    </pre>
  </div>
</div>

<script>
  mermaid.initialize({ startOnLoad: true, securityLevel: 'loose' });
</script>
```

Recommendations:
- Write Mermaid DSL inside `<pre class="mermaid">`.
- Fix the diagram container size for stable layout.

---

## 3. Inline SVG Icon Guide

```html
<div style="display: flex; align-items: center; gap: 8pt;">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14M12 5l7 7-7 7" stroke="#1f2937" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
  <p style="font-size: 12pt; color: #1f2937;">Next step</p>
</div>
```

Rules:
- Always specify `viewBox`.
- Set explicit size via `width`/`height`.
- Use HEX values with `#` prefix for `stroke`/`fill` colors.
- Place text outside SVG using `<p>`, `<h1>`-`<h6>` tags.

---

## 4. Image Usage Rules (Local Path / URL / NanoBanana / Placeholder)

### 이미지 컨테이너 비율 가이드 (NanoBanana 비율 힌트 결정)

슬라이드 레이아웃에서 이미지 컨테이너의 실제 비율에 맞춰 NanoBanana 비율 힌트를 결정한다. 상세: `.claude/docs/nanoBanana-guide.md` "이미지 비율 결정 규칙" 섹션.

| 레이아웃 | 이미지 컨테이너 | 비율 힌트 |
|---------|---------------|----------|
| 전체 배경 (표지, 배경) | 720×405pt | `[16:9]` |
| 좌우 50:50 분할 (body padding 없음) | 360×405pt | `[3:4]` |
| 좌우 55:45 분할 (body padding 없음) | 396×405pt | `[1:1]` |
| 좌우 분할 (body padding 있음) | ~330~360×290pt | `[4:3]` |
| 일러스트/아이콘 (독립) | 정사각 | `[1:1]` |

### NanoBanana Generated Image (Preferred)
```html
<img src="assets/slide-05-smart-warehouse.png" alt="스마트 창고 내부 전경"
     style="width: 340pt; height: 220pt; object-fit: cover; border-radius: 8pt;">
```

### Local Path Image
```html
<img src="/Users/yourname/projects/assets/team-photo.png" alt="Team photo"
     style="width: 220pt; height: 140pt; object-fit: cover;">
```

### URL Image
```html
<img src="https://images.example.com/hero.png" alt="Hero image"
     style="width: 220pt; height: 140pt; object-fit: cover;">
```

### Placeholder (Image Stand-In)
```html
<div data-image-placeholder style="width: 220pt; height: 140pt; border: 1px dashed #c7c7c7; background: #f3f4f6;"></div>
```

Rules:
- Always include `alt` on `img` tags.
- **NanoBanana 이미지 우선**: `assets/` 폴더에 이미지가 있으면 반드시 사용.
- NanoBanana 이미지 경로: `assets/slide-{NN}-{slug}.png` (상대 경로 사용).
- 이미지 미준비 시 `data-image-placeholder`로 영역 확보 (나중에 교체 가능).
- Prefer local paths; URL images risk network failures.
- Use high-resolution originals and fit with `object-fit`.

### 이미지 위 텍스트 오버레이 — WCAG AA 접근성 규칙 (#9)

이미지 위에 텍스트를 배치할 때 **WCAG AA 대비율** (일반 텍스트 4.5:1, 큰 텍스트 3:1)을 충족해야 한다.

**방법 1: 반투명 오버레이 (가장 안정적)**
```html
<div style="position: relative;">
  <img src="assets/slide-01-cover.png" style="width: 100%; height: 100%; object-fit: cover;">
  <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.55);"></div>
  <div style="position: absolute; inset: 0; padding: 48pt; display: flex; flex-direction: column; justify-content: center;">
    <h1 style="color: #ffffff; font-size: 48pt; font-weight: 700;">제목</h1>
  </div>
</div>
```

**방법 2: 텍스트 그림자 (가벼운 오버레이)**
```html
<h1 style="color: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.6);">제목</h1>
```

**방법 3: 반투명 배경 패널 (한쪽에 텍스트)**
```html
<div style="position: absolute; left: 0; top: 0; bottom: 0; width: 50%; background: rgba(0,0,0,0.7);"></div>
```
> linear-gradient는 PPTX에서 렌더링 불가 — 단색 rgba() 또는 solid color만 사용

**선택 기준:**
- 전면 이미지 + 중앙 텍스트 → 방법 1 (반투명 오버레이)
- 이미지 위 제목만 → 방법 2 (텍스트 그림자)
- 좌측 텍스트 + 우측 이미지 → 방법 3 (반투명 패널)
- 밝은 이미지에 어두운 텍스트 → `rgba(255,255,255,0.85)` 오버레이 + 어두운 텍스트
