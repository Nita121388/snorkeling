import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLessons, nextLessonId, renderLesson, staleLessons, lessonsCovering, specInjectability } from './lesson.mjs';

const MD = `# LESSONS

### L-0001 夜间遇到登录墙必须 park
- key: park:human-wall
- 触发: 需要验证码或真机点击
- 规范: \`docs/sync-audit/sync-governance.md\`
- 入库: 2026-11-01
- 引用: 3

### L-0002 器具必须能对已知坏样本变红
- key: park:flaky
- 触发: 测试非确定性
- 规范: \`.trellis/spec/guides/day-night-loop-contract.md\`
- 入库: 2026-08-01
- 引用: 0
`;

test('parseLessons: 抽出全部字段', () => {
    const l = parseLessons(MD);
    assert.equal(l.length, 2);
    assert.equal(l[0].id, 'L-0001');
    assert.equal(l[0].key, 'park:human-wall');
    assert.equal(l[0].spec, 'docs/sync-audit/sync-governance.md');
    assert.equal(l[0].refs, 3);
});

test('nextLessonId: 递增且补零', () => {
    assert.equal(nextLessonId(MD), 'L-0003');
    assert.equal(nextLessonId(''), 'L-0001');
});

test('renderLesson: 字段顺序稳定（可 diff）', () => {
    const text = renderLesson({ id: 'L-0009', title: 'T', key: 'park:budget', trigger: 'tr', spec: 'a/b.md', at: '2026-11-05', refs: 0 });
    assert.match(text, /^### L-0009 T\n- key: park:budget\n- 触发: tr\n- 规范: `a\/b\.md`\n- 入库: 2026-11-05\n- 引用: 0$/);
});

test('staleLessons: 超 90 天且零引用才算陈旧', () => {
    const now = Date.parse('2026-11-05T00:00:00Z');
    const stale = staleLessons(parseLessons(MD), { now, days: 90 });
    assert.deepEqual(stale.map((l) => l.id), ['L-0002']);
});

test('lessonsCovering: 按 G8 问题键对账', () => {
    assert.equal(lessonsCovering(parseLessons(MD), 'park:human-wall').length, 1);
    assert.equal(lessonsCovering(parseLessons(MD), 'park:nope').length, 0);
});

test('specInjectability: 有 paths 前缀才可注入', () => {
    assert.equal(specInjectability('docs/sync-audit/sync-governance.md').ok, false);
    assert.match(specInjectability('docs/sync-audit/sync-governance.md').reason, /frontmatter/);
    assert.equal(specInjectability('.trellis/spec/guides/day-night-loop-contract.md').ok, true);
    assert.equal(specInjectability('nope/missing.md').ok, false);
});
