import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { BlockRepository } from '../usecases/ports.js';
import { Theme, THEME_TOKENS } from '../domain/index.js';

// FsBlockRepository — 파일시스템에서 블록 HTML·테마 CSS·에셋·매니페스트를 로드.
// 루트(프로젝트 디렉토리) 기준 상대 경로. 경로 이탈 방지.
export class FsBlockRepository extends BlockRepository {
  constructor({ root }) {
    super();
    if (!root) throw new TypeError('FsBlockRepository 는 root 가 필요합니다.');
    this.root = resolve(root);
    this.assetsDir = join(this.root, 'assets');
    this.blocksDir = join(this.root, 'blocks');
    this.themesDir = join(this.root, 'themes');
    this.moodsDir = join(this.themesDir, 'moods');
    this.manifestsDir = join(this.root, 'manifests');
    this.templatesDir = join(this.root, 'templates');
  }

  /** 교과 템플릿(templates/{name}.json) 로드. */
  async readTemplate(name) {
    const file = name.endsWith('.json') ? name : `${name}.json`;
    return JSON.parse(await readFile(this.#safe(this.templatesDir, file), 'utf8'));
  }

  #safe(baseDir, rel) {
    const p = resolve(baseDir, rel);
    if (!p.startsWith(baseDir + sep) && p !== baseDir) {
      throw new Error(`경로 이탈이 차단되었습니다: ${rel}`);
    }
    return p;
  }

  async readAsset(name) {
    return readFile(this.#safe(this.assetsDir, name), 'utf8');
  }

  async loadBlockHtml(file) {
    return readFile(this.#safe(this.blocksDir, file), 'utf8');
  }

  async listBlocks() {
    const out = [];
    const walk = async (dir) => {
      if (!existsSync(dir)) return;
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) await walk(full);
        else if (ent.name.endsWith('.html')) out.push(relative(this.blocksDir, full).split(sep).join('/'));
      }
    };
    await walk(this.blocksDir);
    return out.sort();
  }

  async loadThemeCss(name) {
    const file = name.endsWith('.css') ? name : `${name}.css`;
    return readFile(this.#safe(this.themesDir, file), 'utf8');
  }

  /**
   * 무드 팩 CSS(themes/moods/{name}.css) 로드. 디자인 토큰(--wg-*)의 값 세트만 담은 :root 블록으로,
   * AssembleWorksheet 가 theme 레이어 뒤에 한 겹 주입한다(무드 지정 시에만 호출). 경로 이탈 차단.
   */
  async loadMoodCss(name) {
    const file = name.endsWith('.css') ? name : `${name}.css`;
    return readFile(this.#safe(this.moodsDir, file), 'utf8');
  }

  /** 등록된 무드 이름의 닫힌 목록(themes/moods/*.css → 확장자 제거). 폴더가 없으면 [](하위호환). */
  async listMoods() {
    if (!existsSync(this.moodsDir)) return [];
    return (await readdir(this.moodsDir))
      .filter((f) => f.endsWith('.css'))
      .map((f) => f.replace(/\.css$/, ''))
      .sort();
  }

  async listThemes() {
    if (!existsSync(this.themesDir)) return [];
    const files = (await readdir(this.themesDir)).filter((f) => f.endsWith('.css'));
    const themes = [];
    for (const f of files) {
      const css = await readFile(join(this.themesDir, f), 'utf8');
      const tokens = parseRootTokens(css);
      const name = f.replace(/\.css$/, '');
      if (THEME_TOKENS.every((t) => tokens[t])) {
        themes.push(new Theme({ name, subject: null, tokens }));
      }
    }
    return themes;
  }

  async readManifest(nameOrPath) {
    const file = nameOrPath.endsWith('.json') ? nameOrPath : `${nameOrPath}.json`;
    const p = existsSync(resolve(file)) ? resolve(file) : this.#safe(this.manifestsDir, file);
    return JSON.parse(await readFile(p, 'utf8'));
  }

  /** 블록 타입 어휘 + 계약(blocks/vocabulary.json). 파일이 없으면 null(하위호환). */
  async readVocabulary() {
    const p = join(this.blocksDir, 'vocabulary.json');
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8'));
  }

  /** 아키타입 레지스트리(blocks/archetypes.json). 파일이 없으면 null(하위호환). */
  async readArchetypes() {
    const p = join(this.blocksDir, 'archetypes.json');
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8'));
  }
}

/** :root { --c: #...; } 에서 토큰값 추출. */
export function parseRootTokens(css) {
  const m = /:root\s*\{([^}]*)\}/i.exec(css);
  const tokens = {};
  if (!m) return tokens;
  for (const decl of m[1].split(';')) {
    const dm = /(--[a-z0-9-]+)\s*:\s*([^;]+)/i.exec(decl);
    if (dm) tokens[dm[1].trim()] = dm[2].trim();
  }
  return tokens;
}
