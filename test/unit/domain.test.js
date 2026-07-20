import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Standard, Theme, Variant, Block, Worksheet } from '../../src/domain/index.js';

test('Standard: 원문 없이 생성 불가(창작 금지 불변식)', () => {
  assert.throws(() => new Standard({ code: '[9과14-02]', text: '' }), /원문/);
  const s = new Standard({ code: '9과14-02', text: '전기 회로 …' });
  assert.equal(s.bracketedCode(), '[9과14-02]');
});

test('Theme: 6개 토큰이 모두 있어야 하고 팔레트 hex 를 노출', () => {
  const t = new Theme({
    name: 'ko', subject: 'korean',
    tokens: { '--c': '#7cb342', '--c2': '#8bc34a', '--clite': '#f6faf0', '--cstrip': '#9ccc65', '--clabel': '#dcedc8', '--cink': '#558b2e' },
  });
  assert.ok(t.paletteHexes().has('#7cb342'));
  assert.match(t.toRootCss(), /--c:\s*#7cb342/);
  assert.throws(() => new Theme({ name: 'x', tokens: { '--c': '#000' } }), /토큰/);
});

test('Variant: student 는 정답을 배제한다', () => {
  assert.equal(new Variant('student').excludesAnswers(), true);
  assert.equal(new Variant('teacher').excludesAnswers(), false);
  assert.throws(() => new Variant('bogus'), /student\|teacher/);
});

test('Worksheet: 최소 1페이지·Block 타입 강제, 페이지수/컴포넌트 조회', () => {
  const b = new Block({ id: 'h', type: 'header', content: '<div class="wsheet-title-wrap"></div>' });
  const w = new Worksheet({ subject: 'korean', themeName: 'ko', pages: [[b]] });
  assert.equal(w.pageCount(), 1);
  assert.equal(w.hasBlockType('header'), true);
  assert.equal(w.hasBlockType('rubric'), false);
  assert.throws(() => new Worksheet({ subject: 'x', themeName: 'ko', pages: [] }), /최소 1개 페이지/);
});
