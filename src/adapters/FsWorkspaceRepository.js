import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizeDocName, workspaceLayout } from '../usecases/workspace.js';

// FsWorkspaceRepository — 문서 워크스페이스(worksheets/<문서명>/)의 파일 IO.
// 정책(경로 파생·스냅샷 이름·meta 스키마)은 순수 usecase(workspace.js)가 결정하고
// 여기는 디렉토리·파일 읽고쓰기만 한다. 경로 이탈 방지는 FsBlockRepository 패턴.
export class FsWorkspaceRepository {
  /** @param {{baseDir?:string|null}} opts baseDir 기본값 = <cwd>/worksheets */
  constructor({ baseDir = null } = {}) {
    this.baseDir = resolve(baseDir || join(process.cwd(), 'worksheets'));
  }

  /** 정규화 + 경로이탈 방지를 거친 레이아웃. */
  layout(name) {
    const docName = normalizeDocName(name);
    const l = workspaceLayout(this.baseDir, docName);
    if (!resolve(l.dir).startsWith(this.baseDir + sep)) {
      throw new Error(`경로 이탈이 차단되었습니다: ${name}`);
    }
    return { name: docName, ...l };
  }

  docExists(name) {
    return existsSync(this.layout(name).dir);
  }

  async createDoc(name) {
    const l = this.layout(name);
    await mkdir(l.assetsDir, { recursive: true });
    await mkdir(l.metaDir, { recursive: true });
    await mkdir(l.historyDir, { recursive: true });
    return l;
  }

  async writeManifest(name, manifest) {
    await writeFile(this.layout(name).manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  async readManifest(name) {
    return JSON.parse(await readFile(this.layout(name).manifestPath, 'utf8'));
  }

  async writeMeta(name, meta) {
    const l = this.layout(name);
    // 외부 생성/구버전 문서는 .worksheet-grab/ 이 없을 수 있다(readMeta 의 null 경로와 동일 전제).
    // 부모 디렉터리 없이 writeFile 하면 ENOENT 로 저장이 중간 실패해 부분 커밋(manifest 만 교체,
    // meta 부재)을 남긴다 — 쓰기 직전에 보장 생성한다.
    await mkdir(l.metaDir, { recursive: true });
    await writeFile(l.metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  }

  /** meta.json 이 없으면 null(미완성/외부 생성 문서 — checkCommitIntegrity 가 경고). */
  async readMeta(name) {
    const p = this.layout(name).metaPath;
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8'));
  }

  /**
   * HTML 산출물 쓰기. 통합본(worksheet.html)은 받지 않는다 — 정답 물리 포함
   * 누출 벡터라 워크스페이스에 존재해선 안 된다(E1 확정, E2 캔버스 예약).
   * @param {string} name @param {{student?:string, teacher:string}} htmls
   */
  async writeVariantHtml(name, { student, teacher }) {
    const l = this.layout(name);
    await writeFile(l.teacherPath, teacher, 'utf8');
    if (typeof student === 'string') await writeFile(l.studentPath, student, 'utf8');
  }

  /** 누출 보류 시 이전 저장의 student.html 잔존을 제거한다. */
  async removeStudentHtml(name) {
    const p = this.layout(name).studentPath;
    if (existsSync(p)) await rm(p);
  }

  async writeSnapshot(name, fileName, manifest) {
    const l = this.layout(name);
    // writeMeta 와 동일 전제: 외부 생성 문서는 history/ 가 없을 수 있다 — 쓰기 직전 보장 생성.
    await mkdir(l.historyDir, { recursive: true });
    await writeFile(join(l.historyDir, fileName), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }

  /** history/ 스냅샷 파일명 목록(일련번호 순 정렬). */
  async listSnapshots(name) {
    const l = this.layout(name);
    if (!existsSync(l.historyDir)) return [];
    return (await readdir(l.historyDir)).filter((f) => /^\d{4}-.*\.manifest\.json$/.test(f)).sort();
  }

  /** 일련번호("0001") 또는 전체 파일명으로 스냅샷 manifest 로드. */
  async readSnapshot(name, serialOrFileName) {
    const l = this.layout(name);
    const snapshots = await this.listSnapshots(name);
    const key = String(serialOrFileName);
    const file = snapshots.find((f) => f === key || f.startsWith(`${key.padStart(4, '0')}-`));
    if (!file) throw new Error(`스냅샷을 찾을 수 없습니다: ${key} (보유: ${snapshots.join(', ') || '없음'})`);
    return JSON.parse(await readFile(join(l.historyDir, file), 'utf8'));
  }

  /** 워크스페이스의 문서 목록: [{name, meta|null}]. */
  async listDocuments() {
    if (!existsSync(this.baseDir)) return [];
    const out = [];
    for (const ent of await readdir(this.baseDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.')) continue; // .presets 등 자산 디렉토리는 문서가 아니다
      out.push({ name: ent.name, meta: await this.readMeta(ent.name) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
