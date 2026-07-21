import { checkCommitIntegrity } from './workspace.js';

// OpenDocument — 워크스페이스 문서 로드(렌더 없음). E2 에디터 서버의 로드 진입점이자
// CLI `doc open` 의 코어. 커밋 마커(meta) 정합을 검사해 부분쓰기·unsafe 상태를
// warnings 로 알린다(로드는 허용 — fail-open 조회, fail-closed 는 export 소관).
export class OpenDocument {
  /** @param {{workspace}} deps */
  constructor({ workspace }) {
    if (!workspace) throw new TypeError('OpenDocument 는 workspace 리포지토리가 필요합니다.');
    this.workspace = workspace;
  }

  /**
   * @param {{name:string}} args
   * @returns {Promise<{name:string, manifest:object, meta:object|null, paths:object, history:string[], warnings:string[]}>}
   */
  async execute({ name }) {
    const layout = this.workspace.layout(name);
    if (!this.workspace.docExists(layout.name)) {
      throw new Error(`문서가 없습니다: ${layout.name}. "doc list" 로 문서 목록을 확인하세요.`);
    }
    const manifest = await this.workspace.readManifest(layout.name);
    const meta = await this.workspace.readMeta(layout.name);
    const history = await this.workspace.listSnapshots(layout.name);
    const { warnings } = checkCommitIntegrity({ meta, snapshots: history });
    return { name: layout.name, manifest, meta, paths: layout, history, warnings };
  }
}
