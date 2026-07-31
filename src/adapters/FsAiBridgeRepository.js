import { readFile, writeFile, mkdir, rename, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { canTransition, validateRequest, validateResponse, isUnsupportedResponse } from '../usecases/aiBridge.js';

function assertPortablePathComponent(id) {
  if (typeof id !== 'string' || id.length === 0 || id === '.' || id === '..' || /[\/\\\0]/.test(id)) {
    throw new Error(`경로 이탈을 차단했습니다: ${id}`);
  }
}

// FsAiBridgeRepository — AI 브리지 파일 큐(<baseDir>/.ai-bridge/{requests,responses}/)의 IO.
// 에디터 서버(요청 생성·cancelled/applied 기록)와 구독 AI CLI(응답 생성)는 별도
// 프로세스라 파일이 유일한 채널이다. 쓰기는 tmp→rename 원자 교체(부분 파일이
// 상대 프로세스에 절대 노출되지 않음 — TOCTOU 방어), 손상 파일은 스킵+경고.
//
// 상태 표현(소유권): 요청 파일의 status 필드는 서버 소유(pending→cancelled|applied),
// answered 는 응답 파일 존재로 표현(CLI 소유 — 요청 파일을 건드리지 않아 경합 없음).
// getStatus 우선순위: cancelled > applied > answered > pending — 취소가 레이스에서 이긴다.
export class FsAiBridgeRepository {
  constructor({ baseDir }) {
    if (!baseDir) throw new TypeError('FsAiBridgeRepository 는 baseDir 가 필요합니다.');
    this.baseDir = resolve(baseDir);
    this.dir = join(this.baseDir, '.ai-bridge');
    if (!this.dir.startsWith(this.baseDir + sep)) throw new Error('경로 이탈이 차단되었습니다.');
    this.requestsDir = join(this.dir, 'requests');
    this.responsesDir = join(this.dir, 'responses');
  }

  #requestPath(id) {
    assertPortablePathComponent(id);
    const p = resolve(this.requestsDir, `${id}.json`);
    if (!p.startsWith(this.requestsDir + sep)) throw new Error(`경로 이탈이 차단되었습니다: ${id}`);
    return p;
  }

  #responsePath(id) {
    assertPortablePathComponent(id);
    const p = resolve(this.responsesDir, `${id}.json`);
    if (!p.startsWith(this.responsesDir + sep)) throw new Error(`경로 이탈이 차단되었습니다: ${id}`);
    return p;
  }

  async #writeAtomic(path, data) {
    await mkdir(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await rename(tmp, path);
  }

  async #readJson(path, validate) {
    if (!existsSync(path)) return null;
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      return validate(data) ? data : null; // 손상/비정합 → 스킵(경고는 호출자 소관)
    } catch {
      return null;
    }
  }

  async putRequest(request) {
    if (!validateRequest(request)) throw new Error('요청 스키마가 유효하지 않습니다.');
    await this.#writeAtomic(this.#requestPath(request.id), request);
  }

  async readRequest(id) {
    return this.#readJson(this.#requestPath(id), validateRequest);
  }

  async putResponse(response) {
    if (!validateResponse(response)) throw new Error('응답 스키마가 유효하지 않습니다.');
    await this.#writeAtomic(this.#responsePath(response.id), response);
  }

  async readResponse(id) {
    return this.#readJson(this.#responsePath(id), validateResponse);
  }

  /** cancelled > applied > answered > pending (취소 우선 — cancel/respond 레이스에서 취소 승리). */
  async getStatus(id) {
    const req = await this.readRequest(id);
    if (!req) return null;
    if (req.status === 'cancelled') return 'cancelled';
    if (req.status === 'applied') return 'applied';
    const resp = await this.readResponse(id);
    if (resp) return isUnsupportedResponse(resp) ? 'unsupported' : 'answered';
    return 'pending';
  }

  /** 서버 소유 상태 기록(cancelled·applied). 전이 정책 위반 시 오류. */
  async setStatus(id, to) {
    const req = await this.readRequest(id);
    if (!req) throw new Error(`요청을 찾을 수 없습니다: ${id}`);
    const from = await this.getStatus(id);
    if (!canTransition(from, to)) throw new Error(`상태 전이 불가: ${from} → ${to} (${id})`);
    await this.#writeAtomic(this.#requestPath(id), { ...req, status: to });
  }

  /** 대기(pending) 요청 목록 — id 순 정렬(시각 접두라 도착순). */
  async listPending() {
    if (!existsSync(this.requestsDir)) return [];
    const out = [];
    for (const f of (await readdir(this.requestsDir)).filter((n) => n.endsWith('.json')).sort()) {
      const id = f.replace(/\.json$/, '');
      const req = await this.readRequest(id);
      if (req && (await this.getStatus(id)) === 'pending') out.push(req);
    }
    return out;
  }

  /** 전체 요청 나열(상태 포함 — ai list 용). */
  async listAll() {
    if (!existsSync(this.requestsDir)) return [];
    const out = [];
    for (const f of (await readdir(this.requestsDir)).filter((n) => n.endsWith('.json')).sort()) {
      const id = f.replace(/\.json$/, '');
      const req = await this.readRequest(id);
      if (req) out.push({ ...req, status: await this.getStatus(id) });
    }
    return out;
  }

  /** 종료 상태(applied·cancelled) 요청·응답 파일 정리. @returns 제거된 id 목록 */
  async prune({ ids = null } = {}) {
    const removed = [];
    for (const entry of await this.listAll()) {
      const terminal = entry.status === 'applied' || entry.status === 'cancelled';
      const targeted = ids ? ids.includes(entry.id) : terminal;
      if (!targeted) continue;
      await rm(this.#requestPath(entry.id), { force: true });
      await rm(this.#responsePath(entry.id), { force: true });
      removed.push(entry.id);
    }
    return removed;
  }
}
