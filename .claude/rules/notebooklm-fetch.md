# NotebookLM 콘텐츠 추출

NotebookLM 노트북 URL이 제공되면 이 절차로 소스 내용을 추출한다.

## 방법: Playwright 영구 세션

Google 로그인이 필요하므로 headful 브라우저 + 영구 세션 디렉토리를 사용한다.

```bash
node scripts/fetch-notebooklm.js <노트북-URL> [출력파일]
```

### 동작 방식
1. `.playwright-session/` 디렉토리에 브라우저 세션 유지
2. 첫 실행 시 Google 로그인 화면이 뜸 → 사용자가 직접 로그인
3. 로그인 후 자동으로 노트북 내용 추출 → `notebook-content.md`로 저장
4. 이후 실행부터는 세션이 유지되어 자동 접근

### 사용자 안내 (첫 실행 시)

```
NotebookLM에 접근하려면 Google 로그인이 필요합니다.
지금 브라우저 창이 열리면서 Google 로그인 화면이 나타납니다.

로그인을 완료하시면 자동으로 내용을 가져옵니다.
(한 번만 로그인하면 다음부터는 자동으로 접근됩니다)
```

### 추출 내용
- 노트북 제목
- 소스 목록 (Source 패널)
- 노트 (Notes 패널)
- 메인 콘텐츠 영역

### 제한사항
- WebFetch로는 접근 불가 (Google 인증 302 리다이렉트)
- headless 모드 불가 (Google이 자동화 감지 차단)
- `.playwright-session/`은 .gitignore에 포함 필수

## 추출 후 흐름

notebook-content.md 저장 후 → 내용 분석 → slide-outline.md 작성 → 사용자 승인 대기
