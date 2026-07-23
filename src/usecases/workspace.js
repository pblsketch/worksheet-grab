import { join } from 'node:path';

// workspace — 문서 워크스페이스의 순수 정책(HANDOFF §5 저장 모델).
// 문서명 정규화·경로 파생·스냅샷 일련번호·meta 스키마·커밋 정합 판정만 담당한다.
// 파일 IO 는 FsWorkspaceRepository(adapter), 저장/로드 오케스트레이션은
// SaveDocument/OpenDocument 가 맡는다. Chrome·FS 무지 → 목 없이 단위 테스트 가능.

export const META_SCHEMA_VERSION = 1;

/** 문서명 정규화: 한글 보존, 비허용 문자는 _(worksheetBase 관례), 빈 이름 거부. */
export function normalizeDocName(raw) {
  const name = String(raw ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) throw new Error(`문서명이 비어 있습니다: "${raw}"`);
  return name;
}

/**
 * §5 확정 레이아웃의 경로 파생. worksheet.html(통합본) 슬롯은 E1 미포함 —
 * 통합본은 정답을 물리 포함한 누출 벡터라 워크스페이스에 쓰지 않는다(E2 편집 캔버스 예약).
 */
export function workspaceLayout(baseDir, name) {
  const dir = join(baseDir, name);
  const metaDir = join(dir, '.worksheet-grab');
  return {
    dir,
    manifestPath: join(dir, 'worksheet.manifest.json'),
    studentPath: join(dir, 'worksheet-student.html'),
    teacherPath: join(dir, 'worksheet-teacher.html'),
    studentPdfPath: join(dir, 'worksheet-student.pdf'),
    teacherPdfPath: join(dir, 'worksheet-teacher.pdf'),
    assetsDir: join(dir, 'assets'),
    metaDir,
    metaPath: join(metaDir, 'meta.json'),
    historyDir: join(dir, 'history'),
  };
}

/** 스냅샷 파일명: <4자리 일련번호>-<ISO압축>.manifest.json */
export function snapshotName(serial, date) {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${String(serial).padStart(4, '0')}-${iso}.manifest.json`;
}

/** 다음 스냅샷 일련번호: 기존 파일명들의 최대값 + 1 (없으면 1). */
export function nextSnapshotSerial(existingNames) {
  let max = 0;
  for (const n of existingNames ?? []) {
    const m = /^(\d{4})-/.exec(String(n));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * meta.json 빌드. createdAt 은 최초 저장 시각을 보존하고 revision 은 저장마다 +1.
 * unsafe: 직전 저장의 student 재렌더가 정답 누출(error)을 내 student.html 쓰기가
 * 보류됐음을 뜻한다. E6 export 는 이 마커를 fail-closed 로 승격한다.
 *
 * checkpointName/serial(S2.4, C-3): SaveDocument.checkpoint 의 명명 체크포인트 계약 — 이름이
 * 주어지면 meta.checkpoints 이력에 {name, revision, serial, at} 을 추가해 "이름 → 어느 스냅샷
 * 일련번호" 매핑을 남긴다(workspace.readSnapshot(name, serial) 로 복원 가능). rev 는 여전히
 * 체크포인트(=저장) 단위로만 증가하므로 checkCommitIntegrity 의 rev==스냅샷개수 불변식은 그대로다.
 * 이름 없는(디바운스 자동) 체크포인트는 이력에 추가하지 않되 기존 이력은 그대로 이어받는다.
 */
export function buildMeta(name, manifest, { now, prev = null, unsafe = false, checkpointName = null, serial = null } = {}) {
  const revision = (prev?.revision ?? 0) + 1;
  const checkpoints = Array.isArray(prev?.checkpoints) ? [...prev.checkpoints] : [];
  if (checkpointName) {
    checkpoints.push({ name: checkpointName, revision, serial, at: now.toISOString() });
  }
  return {
    schemaVersion: META_SCHEMA_VERSION,
    name,
    title: manifest.docTitle || '',
    subject: manifest.subject || '',
    standards: manifest.standards || [],
    paper: manifest.paper ?? null,
    revision,
    createdAt: prev?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    unsafe: !!unsafe,
    checkpoints,
  };
}

/**
 * 커밋 정합 판정(부분쓰기 감지). meta 는 저장 순서의 마지막에 쓰이는 커밋 마커이므로
 * meta 부재·revision↔스냅샷 개수 불일치는 중단된 저장을 시사한다. 로드는 허용하되
 * warnings 로 알린다(OpenDocument/E2 서버 소비).
 */
export function checkCommitIntegrity({ meta, snapshots }) {
  const warnings = [];
  if (!meta) {
    warnings.push('meta.json 이 없습니다 — 미완성/외부 생성 문서(부분쓰기 의심)일 수 있습니다.');
    return { ok: false, warnings };
  }
  const count = (snapshots ?? []).length;
  if (meta.revision !== count) {
    warnings.push(`revision(${meta.revision})과 히스토리 스냅샷 개수(${count})가 다릅니다 — 부분쓰기 의심.`);
  }
  if (meta.unsafe === true) {
    warnings.push('정답 누출로 student.html 이 보류된 문서입니다(unsafe). 누출 해소 전 export 가 차단됩니다.');
  }
  return { ok: warnings.length === 0, warnings };
}
