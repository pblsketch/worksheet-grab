import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizeDocName } from '../usecases/workspace.js';
import { workbookLayout, validateWorkbook } from '../usecases/workbook.js';

// FsWorkbookRepository — 자료집 장부(workbooks/<명>/)의 파일 IO. 정책(스키마·경로 파생)은
// 순수 usecase(workbook.js)가 결정하고 여기는 디렉토리·workbook.json 읽고쓰기만 한다.
// 경로 이탈 방지는 FsWorkspaceRepository.js:16 패턴 복제. 멤버 문서(worksheets/)는 이
// 어댑터가 만지지 않는다 — 문서 접근은 별도 FsWorkspaceRepository 로 읽기 전용(교차 저장 금지).
export class FsWorkbookRepository {
  /** @param {{baseDir?:string|null}} opts baseDir 기본값 = <cwd>/workbooks */
  constructor({ baseDir = null } = {}) {
    this.baseDir = resolve(baseDir || join(process.cwd(), 'workbooks'));
  }

  /** 정규화 + 경로이탈 방지를 거친 레이아웃. */
  layout(name) {
    const wbName = normalizeDocName(name);
    const l = workbookLayout(this.baseDir, wbName);
    if (!resolve(l.dir).startsWith(this.baseDir + sep)) {
      throw new Error(`경로 이탈이 차단되었습니다: ${name}`);
    }
    return { name: wbName, ...l };
  }

  exists(name) {
    return existsSync(this.layout(name).workbookPath);
  }

  /** 자료집 디렉토리 생성 + workbook.json 초기 기록(검증). */
  async create(name, workbook) {
    const l = this.layout(name);
    await mkdir(l.dir, { recursive: true });
    await this.writeWorkbook(name, workbook);
    return l;
  }

  /** workbook.json 로드 + 스키마 검증(fail-closed). */
  async readWorkbook(name) {
    const raw = JSON.parse(await readFile(this.layout(name).workbookPath, 'utf8'));
    return validateWorkbook(raw);
  }

  /** workbook.json 기록. 검증을 통과한 정규형만 디스크에 쓴다. */
  async writeWorkbook(name, workbook) {
    const valid = validateWorkbook(workbook);
    const l = this.layout(name);
    await mkdir(l.dir, { recursive: true });
    await writeFile(l.workbookPath, JSON.stringify(valid, null, 2) + '\n', 'utf8');
    return valid;
  }

  /** 자료집 목록: [{name, workbook|null}]. workbook.json 부재/파손이면 null. */
  async list() {
    if (!existsSync(this.baseDir)) return [];
    const out = [];
    for (const ent of await readdir(this.baseDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      let workbook = null;
      try {
        workbook = await this.readWorkbook(ent.name);
      } catch { /* 파손·부재 → null(목록엔 남긴다) */ }
      out.push({ name: ent.name, workbook });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
