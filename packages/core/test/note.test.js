import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRootBlock,
  countNote,
  createDefaultData,
  findNoteEntry,
  findBlockOwner,
  indentBlock,
  isBlockDescendant,
  makeNote,
  moveNoteBlock,
  noteFromText,
  noteToText,
  outdentBlock,
  pasteIntoNote,
  removeBlock,
  splitBlock,
  toggleBlock
} from '../src/index.js';

const sample = () => makeNote([{ _c: [['A', { _c: [['A1', ['A1a']], 'A2'] }], 'B'] }]);

test('moveNoteBlock 跨知识点移动并保留子树', () => {
  const nodes = [
    { id: 'a', note: makeNote([['A', [['A1', ['A1a']]]], 'B']) },
    { id: 'b', note: makeNote([['C', []]]) }
  ];
  const a1 = nodes[0].note[0].children[0];
  const a1id = a1.id;
  const result = moveNoteBlock(nodes, a1id, 'b', null, 1);
  assert.equal(result.ok, true);
  assert.equal(findBlockOwner(nodes, a1id).node.id, 'b');
  assert.equal(nodes[1].note.length, 2);
  assert.equal(nodes[1].note[1].text, 'A1');
  assert.equal(nodes[1].note[1].children.length, 1);
  assert.equal(nodes[1].note[1].children[0].text, 'A1a');
  assert.equal(nodes[0].note[0].children.length, 0);
});

test('moveNoteBlock 阻止把块拖进自己的后代', () => {
  const nodes = [{ id: 'a', note: makeNote([['A', [['A1', []]]]]) }];
  const parent = nodes[0].note[0];
  const child = parent.children[0];
  assert.equal(isBlockDescendant(parent, child.id), true);
  const result = moveNoteBlock(nodes, parent.id, 'a', child.id, 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'descendant');
  assert.equal(nodes[0].note[0].id, parent.id);
});

test('makeNote 支持字符串、紧凑数组、并列数组与对象四种写法', () => {
  const note = makeNote([{ _c: ['根', { text: '对象写法', children: ['子'] }, ['数组写法', ['子']]] }]);
  assert.equal(note.length, 3);
  assert.equal(note[0].text, '根');
  assert.equal(note[1].children[0].text, '子');
  assert.equal(note[2].children[0].text, '子');
  assert.ok(note[0].id.startsWith('nb'));
});

test('空文本且无子级的条目会被丢弃', () => {
  assert.equal(makeNote([{ _c: ['', ['  ', []], '保留'] }]).length, 1);
});

test('countNote / noteToText 递归统计', () => {
  const note = sample();
  assert.equal(countNote(note), 5);
  assert.equal(noteToText(note), 'A A1 A1a A2 B');
});

test('splitBlock 在光标处拆成同级两条', () => {
  const note = sample();
  const id = note[0].id;
  const created = splitBlock(note, id, 0, 'ABCD');
  assert.equal(created.text, 'ABCD');
  assert.equal(note[0].text, '');
  assert.equal(note[1].id, created.id);
});

test('indentBlock 把条目挂到上一个同级条目末尾', () => {
  const note = sample();
  const res = indentBlock(note, note[1].id);
  assert.equal(res.ok, true);
  assert.equal(note.length, 1);
  assert.equal(note[0].children.at(-1).text, 'B');
});

test('首条无法缩进，根级无法反缩进', () => {
  const note = sample();
  assert.deepEqual(indentBlock(note, note[0].id), { ok: false, reason: 'first' });
  assert.deepEqual(outdentBlock(note, note[0].id), { ok: false, reason: 'root' });
});

test('outdentBlock 把子级升到父级之后', () => {
  const note = sample();
  const child = note[0].children[0];
  const res = outdentBlock(note, child.id);
  assert.equal(res.ok, true);
  assert.equal(note[1].id, child.id);
  assert.equal(note[0].children.length, 1);
});

test('removeBlock 删除空块并给出聚焦目标', () => {
  const note = makeNote(['A', 'B']);
  const res = removeBlock(note, note[1].id);
  assert.equal(res.ok, true);
  assert.equal(note.length, 1);
  assert.equal(res.focusId, note[0].id);
});

test('只剩一条时 removeBlock 只清空文本', () => {
  const note = makeNote(['唯一']);
  const res = removeBlock(note, note[0].id);
  assert.equal(res.emptied, true);
  assert.equal(note.length, 1);
  assert.equal(note[0].text, '');
});

test('toggleBlock 只在有子级时生效', () => {
  const note = sample();
  assert.equal(toggleBlock(note, note[0].id), true);
  assert.equal(toggleBlock(note, note[1].id), null);
});

test('pasteIntoNote 多行粘贴拆条并去掉项目符号', () => {
  const note = makeNote(['头部']);
  const res = pasteIntoNote(note, note[0].id, 2, '头部', '- 一\n二\n三');
  assert.equal(res.ok, true);
  assert.equal(note.length, 3);
  assert.equal(note[0].text, '头部一');
  assert.equal(note[1].text, '二');
  assert.equal(note[2].text, '三');
});

test('noteFromText 按缩进还原层级', () => {
  const note = noteFromText('第一章\n  1.1 小节\n    细节\n第二章');
  assert.equal(note.length, 2);
  assert.equal(note[0].children[0].text, '1.1 小节');
  assert.equal(note[0].children[0].children[0].text, '细节');
});

test('appendRootBlock 追加空根条目', () => {
  const note = sample();
  const block = appendRootBlock(note);
  assert.equal(note.at(-1).id, block.id);
  assert.ok(findNoteEntry(note, block.id));
});

test('公开种子：10 个知识点、14 条关系', () => {
  const data = createDefaultData();
  assert.equal(data.nodes.length, 10);
  assert.equal(data.edges.length, 14);
  assert.equal(data.categories.length, 8);
  assert.deepEqual(data.nodes.map((n) => n.id).sort(), [
    'calc1',
    'hsmath-func',
    'hsmath-geo',
    'hsmath-stat',
    'hsphys-em',
    'hsphys-mech',
    'hsphys-modern',
    'hsphys-thermo',
    'linalg',
    'prob'
  ]);
  assert.ok(!data.nodes.some((n) => n.id === 'calc2'));
  assert.ok(data.nodes.every((n) => Array.isArray(n.note) && n.note.length > 0));
  // 高中数学 / 高中物理两个新分类都挂上了节点，且都有笔记内容。
  assert.deepEqual([...new Set(data.nodes.map((n) => n.cat))].sort(), [
    'hsmath',
    'hsphys',
    'math'
  ]);
  const total = data.nodes.reduce((sum, n) => sum + countBlocks(n.note), 0);
  assert.ok(total >= 200, `种子笔记块过少：${total}`);
});

function countBlocks(list) {
  return list.reduce((sum, block) => sum + 1 + countBlocks(block.children || []), 0);
}