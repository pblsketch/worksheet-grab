// renderRoutes — Chrome 렌더가 걸린 라우트: PDF 내보내기(POST /export)·정밀 미리보기
// (GET /preview.png)·결과 열기(POST /open).
//
// 세 라우트를 한 모듈에 두는 이유는 in-flight 가드 때문이다: export 와 preview 는 **같은**
// renderBusy 플래그를 공유해야 동시 Chrome spawn 이 겹치지 않는다(겹치면 렌더가 플레이크한다).
// 분리하면 가드가 두 개로 갈라져 우회 경로가 생기므로 클로저 하나로 묶어 둔다.
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { send, sendJson, readJsonBody } from './httpKit.js';
import { ExportDocument, UNSAFE_STUDENT_MESSAGE } from '../../usecases/ExportDocument.js';
import { resolvePaper, paperToPx } from '../../usecases/paper.js';
import { splitSheets } from '../../usecases/sheets.js';
import { countPdfPages } from '../../usecases/pdfInfo.js';

// #5 내보내기 후 '열기' — OS 기본 앱(또는 탐색기)으로 파일/폴더를 연다. 대상 경로는 서버가
// workspace.layout 으로 고정 파생하므로(클라 임의 경로 불가) 로컬 편집 도구로서 안전하다.
// detached + unref 로 서버 프로세스 수명과 분리한다.
function openWithOs(target) {
  if (process.platform === 'win32') {
    // cmd start — 첫 "" 는 창 제목 자리(경로에 공백 있어도 안전). 셸 특수문자는 로컬 신뢰 경로라 무관.
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
}

export function createRenderRoutes({ docName, workspace, opener, getRenderer }) {
  // E6 in-flight 가드: Chrome 렌더(export·preview) 동시 1개 — 클라 버튼 비활성의
  // 서버측 백스톱(겹침 spawn flake 방지). 진행 중이면 409 busy.
  let renderBusy = false;
  const busyResponse = (res) => sendJson(res, 409, { error: 'busy', message: '렌더 진행 중입니다 — 잠시 후 다시 시도하세요.' });

  return [
    // E6 내보내기: 저장본(SaveDocument 게이트 통과 산출물)을 PDF 2벌로.
    // meta.unsafe 는 ExportDocument 가 fail-closed 승격(student 차단·teacher 보존).
    {
      method: 'POST',
      path: '/export',
      async handler({ res }) {
        if (renderBusy) return busyResponse(res);
        renderBusy = true;
        try {
          const exporter = new ExportDocument({ workspace, renderer: getRenderer(), fileExists: existsSync, removeFile: rm });
          return sendJson(res, 200, await exporter.execute({ name: docName }));
        } finally {
          renderBusy = false;
        }
      },
    },
    // E6 정밀 미리보기(§3.4): 저장본을 백그라운드 Chrome 으로 PNG 렌더(첫 페이지).
    // scale:2 핀 고정(레티나) — IHDR 폭 == 2×paperToPx. student 는 unsafe 시 409.
    {
      method: 'GET',
      path: '/preview.png',
      async handler({ req, res }) {
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const mode = query.get('mode') || 'teacher';
        if (mode !== 'teacher' && mode !== 'student') {
          return sendJson(res, 400, { error: 'mode 는 teacher|student' });
        }
        // page(선택, 자료집 페이지별 미리보기) — 저장본을 해당 페이지만 슬라이스 렌더하고 오버플로를 실측한다.
        // 정수 파싱 실패는 renderBusy 진입 전 즉시 400(불필요한 렌더 락 회피).
        const pageRaw = query.get('page');
        let page = null;
        if (pageRaw !== null) {
          const n = Number(pageRaw);
          if (!Number.isInteger(n) || n < 1) {
            return sendJson(res, 400, { error: 'page 는 1 이상의 정수여야 합니다.' });
          }
          page = n;
        }
        if (renderBusy) return busyResponse(res);
        renderBusy = true;
        try {
          const { manifest, meta, paths } = await opener.execute({ name: docName });
          if (page != null) {
            const total = Array.isArray(manifest.pages) ? manifest.pages.length : 0;
            if (page > total) {
              return sendJson(res, 400, { error: `page 는 1..${total} 범위여야 합니다(요청: ${page}).` });
            }
          }
          const unsafe = meta == null || meta.unsafe === true;
          if (mode === 'student' && unsafe) {
            return sendJson(res, 409, { error: 'unsafe', message: UNSAFE_STUDENT_MESSAGE });
          }
          const input = mode === 'student' ? paths.studentPath : paths.teacherPath;
          if (!existsSync(input)) {
            return sendJson(res, 404, { error: '저장본이 없습니다 — 먼저 저장하세요.' });
          }
          const { width, height } = paperToPx(resolvePaper(manifest.paper ?? null) ?? resolvePaper({ size: 'A4' }));

          if (page == null) {
            const out = join(paths.metaDir, `preview-${mode}.png`);
            await getRenderer().renderToPng(input, out, { width, height, scale: 2 });
            return send(res, 200, 'image/png', await readFile(out));
          }

          // T3: 저장본 sections[N-1] 만 남긴 임시 HTML(metaDir 바운드·요청마다 덮어씀)을 슬라이스 렌더.
          const savedHtml = await readFile(input, 'utf8');
          const { head, sections, tail } = splitSheets(savedHtml);
          const singlePageHtml = head + (sections[page - 1] ?? '') + tail;
          const tmpHtmlPath = join(paths.metaDir, `.preview-page-${mode}.html`);
          await writeFile(tmpHtmlPath, singlePageHtml, 'utf8');

          const out = join(paths.metaDir, `preview-${mode}.png`);
          await getRenderer().renderToPng(tmpHtmlPath, out, { width, height, scale: 2 });

          // 오버플로 감지: 동일 단일-페이지 HTML 을 PDF 로도 렌더해 물리 쪽수를 실측한다(PNG 첫 뷰포트는
          // 스크롤 없는 스크린샷이라 넘친 콘텐츠가 잘려 보이지 않을 수 있어 판단 근거로 쓰지 않는다, §2e).
          const tmpPdfPath = join(paths.metaDir, `.preview-page-${mode}.pdf`);
          await getRenderer().renderToPdf(tmpHtmlPath, tmpPdfPath, {});
          const overflowPages = await countPdfPages(tmpPdfPath);

          const headers = { 'Content-Type': 'image/png' };
          if (overflowPages > 1) headers['X-Preview-Overflow'] = '1';
          res.writeHead(200, headers);
          res.end(await readFile(out));
          return undefined;
        } finally {
          renderBusy = false;
        }
      },
    },
    // #5 내보내기 결과 열기: target(teacher-pdf|student-pdf|folder)만 받아 서버가 경로를 고정 파생한다.
    {
      method: 'POST',
      path: '/open',
      async handler({ req, res }) {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
        const layout = workspace.layout(docName);
        const targets = { 'teacher-pdf': layout.teacherPdfPath, 'student-pdf': layout.studentPdfPath, folder: layout.dir };
        const target = targets[body?.target];
        if (!target) {
          return sendJson(res, 400, { error: 'target 은 teacher-pdf|student-pdf|folder 여야 합니다.' });
        }
        if (!existsSync(target)) {
          return sendJson(res, 404, { error: '대상이 아직 없습니다 — 먼저 내보내기하세요.' });
        }
        try {
          openWithOs(target);
          return sendJson(res, 200, { ok: true });
        } catch (e) {
          return sendJson(res, 500, { error: e.message });
        }
      },
    },
  ];
}
