// 에디터 셸(E2) 클라이언트 — 바닐라 ESM, 빌드 0.
// 검수는 서버와 "같은 규칙, 두 런타임"(§3.4): 원본 ValidateWorksheet 를 화이트리스트
// ESM 으로 그대로 import 해 실행한다. 입력은 /shell.json 의 문자열(teacherHtml/
// studentHtml)이다 — iframe DOM 이 아니므로 지연 로드로 비활성 변형 iframe 이 없어도
// 누출(teacher 고정)·인쇄안전(표시 변형) 검수가 항상 성립한다. iframe DOM 접근은
// E3 편집 역동기화에서만 쓴다.
import { ValidateWorksheet } from '/src/usecases/ValidateWorksheet.js';

const MM_TO_PX = 96 / 25.4; // CSS 사양 고정(zoom/DPR 무관)

const shell = await (await fetch('/shell.json')).json();
const stage = document.getElementById('stage');
const overlay = document.getElementById('guide-overlay');
const statusEl = document.getElementById('review-status');
const listEl = document.getElementById('review-list');

document.getElementById('doc-title').textContent = shell.docTitle || '(제목 없음)';
document.getElementById('doc-paper').textContent =
  `${shell.canvasMeta.paper.size} ${shell.canvasMeta.paper.orientation === 'landscape' ? '가로' : '세로'}`;
stage.style.maxWidth = `${shell.canvasMeta.dims.width + 40}px`;

// ── 캔버스: 변형별 iframe 지연 생성(최초 활성만, 토글 시 상대 변형 1회 생성 후 캐시) ──
const frames = { teacher: null, student: null };
let mode = 'teacher';

function ensureFrame(m) {
  if (frames[m]) return Promise.resolve(frames[m]);
  return new Promise((resolveFrame) => {
    const f = document.createElement('iframe');
    f.dataset.mode = m;
    f.className = 'hidden';
    f.addEventListener('load', () => {
      fitFrame(f);
      resolveFrame(f);
    });
    f.srcdoc = shell[`${m}Html`];
    stage.insertBefore(f, overlay);
    frames[m] = f;
  });
}

function fitFrame(f) {
  const doc = f.contentDocument;
  if (doc && doc.documentElement) f.style.height = `${doc.documentElement.scrollHeight}px`;
}

// ── 여백선: 부모 오버레이 레이어(캔버스 iframe 내부 무주입) ──
function drawGuides() {
  overlay.replaceChildren();
  const f = frames[mode];
  if (!f || !f.contentDocument) return;
  const m = shell.canvasMeta.margins;
  const frameTop = f.offsetTop;
  const frameLeft = f.offsetLeft;
  for (const sheet of f.contentDocument.querySelectorAll('.sheet')) {
    const r = sheet.getBoundingClientRect(); // iframe 은 내부 스크롤 없음 → 콘텐츠 좌표
    const g = document.createElement('div');
    g.className = 'margin-guide';
    g.style.left = `${frameLeft + r.left + m.left * MM_TO_PX}px`;
    g.style.top = `${frameTop + r.top + m.top * MM_TO_PX}px`;
    g.style.width = `${r.width - (m.left + m.right) * MM_TO_PX}px`;
    g.style.height = `${r.height - (m.top + m.bottom) * MM_TO_PX}px`;
    overlay.appendChild(g);
  }
}

// ── 라이브 검수 바: recompute(mode) — E3 의 편집 input 이 같은 훅을 재사용한다 ──
const validator = new ValidateWorksheet({
  knownSubjectHexes: shell.validationSeed.knownSubjectHexes,
  paper: shell.validationSeed.paper,
});

function recompute(m) {
  // 누출(answer-leak)은 항상 teacher(마크 생존측 — student 는 물리 제거로 검사 대상 0),
  // 인쇄안전(여백·최소폰트·keep-together·미기입 슬롯)은 현재 표시 중 변형 기준(§3.4).
  const leak = validator.execute(shell.teacherHtml).findings.filter((f) => f.rule === 'answer-leak');
  const safety = validator.execute(shell[`${m}Html`]).findings.filter((f) => f.rule !== 'answer-leak');
  const findings = [...leak, ...safety];

  const worst = findings.some((f) => f.severity === 'error') ? 'error'
    : findings.some((f) => f.severity === 'warning') ? 'warning' : 'ok';
  statusEl.className = `review-status ${worst}`;
  statusEl.textContent = worst === 'ok'
    ? `검수 통과 (${m === 'student' ? '학생용' : '교사용'} 기준)`
    : `검수: error ${findings.filter((f) => f.severity === 'error').length} · warning ${findings.filter((f) => f.severity === 'warning').length}`;

  listEl.replaceChildren(...findings.map((f) => {
    const li = document.createElement('li');
    li.className = f.severity;
    li.dataset.rule = f.rule;
    const b = document.createElement('b');
    b.textContent = `[${f.rule}] `;
    li.append(b, `${f.message} (근거: ${f.evidence})`);
    return li;
  }));
}

// ── 토글 배선 ──
async function setMode(m) {
  mode = m;
  document.getElementById('btn-teacher').classList.toggle('active', m === 'teacher');
  document.getElementById('btn-student').classList.toggle('active', m === 'student');
  const f = await ensureFrame(m);
  for (const [name, frame] of Object.entries(frames)) {
    if (frame) frame.classList.toggle('hidden', name !== m);
  }
  fitFrame(f);
  drawGuides();
  recompute(m);

  // 계측 훅(실브라우저 검증용): 첫 페이지 박스 실측 px 를 body dataset 으로 노출 —
  // Chrome --dump-dom 게이트 테스트가 mm 정밀도를 단정한다.
  const firstSheet = f.contentDocument?.querySelector('.sheet');
  if (firstSheet) {
    const r = firstSheet.getBoundingClientRect();
    document.body.dataset.sheetW = r.width.toFixed(1);
    document.body.dataset.sheetH = r.height.toFixed(1);
  }
  document.body.dataset.mode = m;
  document.body.dataset.guides = String(overlay.querySelectorAll('.margin-guide').length);
}

document.getElementById('btn-teacher').addEventListener('click', () => setMode('teacher'));
document.getElementById('btn-student').addEventListener('click', () => setMode('student'));
document.getElementById('btn-guides').addEventListener('click', (e) => {
  const on = overlay.classList.toggle('hidden') === false;
  e.currentTarget.classList.toggle('active', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
});
window.addEventListener('resize', drawGuides);

for (const w of shell.warnings ?? []) {
  const li = document.createElement('li');
  li.className = 'warning';
  li.textContent = `⚠ ${w}`;
  listEl.appendChild(li);
}

// 초기 모드: 기본 교사용, URL 해시 #student 로 학생용 시작(딥링크·게이트 테스트용).
await setMode(location.hash === '#student' ? 'student' : 'teacher');
