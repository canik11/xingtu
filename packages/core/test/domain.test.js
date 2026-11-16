import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_VERSION,
  KnowledgeIndex,
  LocalStorageBackend,
  MemoryBackend,
  bestMatch,
  buildNode,
  createDefaultData,
  ensureAnchors,
  ensurePositions,
  layoutBounds,
  matchNodeIds,
  mergeCalculusNodes,
  mergeSeedContent,
  mergeSeedAdditions,
  nameTaken,
  needsSeedUpgrade,
  normalizeData,
  panelFocusCamera,
  pickNewNodePosition,
  pruneEmptyCategories,
  randRange,
  replaceNodeEdges,
  sanitizeRelations,
  searchNodes,
  serializeData,
  simulateStep,
  warmup
} from '../src/index.js';

test('normalizeData 拒绝空数据与垃圾输入', () => {
  assert.equal(normalizeData(null), null);
  assert.equal(normalizeData({}), null);
  assert.equal(normalizeData('x'), null);
  // nodes: [] 是合法的「空白知识库」——用户可以自己从零开始建星图，不算坏数据。
  const blank = normalizeData({ nodes: [] });
  assert.deepEqual(blank.nodes, []);
  assert.deepEqual(blank.edges, []);
});

test('normalizeData 迁移老数据：没有 note 时用简介生成大纲', () => {
  const norm = normalizeData({
    version: 1,
    nodes: [{ id: 'a', name: '甲', cat: 'math', desc: '第一行\n- 条目一\n- 条目二', x: 1, y: 2 }],
    edges: []
  });
  assert.equal(norm.migrated, true);
  assert.equal(norm.nodes[0].note.length, 3);
  assert.equal(norm.nodes[0].note[1].text, '条目一');
  assert.equal(norm.contentVersion, 0);
});

test('normalizeData 去重边、丢弃悬空边与自环', () => {
  const norm = normalizeData({
    nodes: [
      { id: 'a', name: 'A', cat: 'math' },
      { id: 'b', name: 'B', cat: 'math' }
    ],
    edges: [
      { a: 'a', b: 'b', label: '相关' },
      { a: 'b', b: 'a', label: '重复' },
      { a: 'a', b: 'a' },
      { a: 'a', b: 'ghost' }
    ]
  });
  assert.equal(norm.edges.length, 1);
  assert.equal(norm.edges[0].label, '相关');
});

test('mergeCalculusNodes 合并高数上下并把边重映射', () => {
  const nodes = [
    { id: 'calc1', name: '高等数学（上）', note: [], desc: '', x: 0, y: 0 },
    { id: 'calc2', name: '高等数学（下）', note: [], desc: '', x: 0, y: 0 },
    { id: 'linalg', name: '线性代数', note: [], desc: '', x: 0, y: 0 }
  ];
  const edges = [
    { a: 'calc2', b: 'linalg', label: 'x' },
    { a: 'calc1', b: 'linalg', label: 'y' }
  ];
  assert.equal(mergeCalculusNodes(nodes, edges), true);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].name, '高等数学');
  assert.equal(edges.length, 1);
});

test('mergeSeedContent 补全笔记但保留用户自己的节点', () => {
  const data = normalizeData({
    version: 2,
    contentVersion: 1,
    categories: createDefaultData().categories,
    nodes: [
      { id: 'calc1', name: '高等数学', cat: 'math', desc: '我的简介', note: [], x: 5, y: 6 },
      { id: 'mine', name: '自定义', cat: 'math', desc: '', note: ['自写'], x: 1, y: 1 }
    ],
    edges: [{ a: 'mine', b: 'calc1', label: '我的连线' }]
  });
  const report = mergeSeedContent(data);
  assert.equal(report.addedNodes, 9);
  assert.ok(report.refreshedNotes >= 1);
  assert.equal(data.nodes.find((n) => n.id === 'mine').note[0].text, '自写');
  assert.equal(data.nodes.find((n) => n.id === 'calc1').note.length, 4);
  assert.ok(data.edges.some((e) => e.label === '我的连线'));
  assert.equal(data.contentVersion, CONTENT_VERSION);
  assert.equal(needsSeedUpgrade(data), false);
});

test('mergeSeedAdditions 只补新节点，不覆盖用户已有笔记', () => {
  const data = normalizeData(createDefaultData());
  data.contentVersion = 2;
  const calc = data.nodes.find((n) => n.id === 'calc1');
  calc.note = [{ id: 'mine-note', text: '我的高数笔记', collapsed: false, children: [] }];
  data.nodes = data.nodes.filter((n) => n.id !== 'linalg');
  data.edges = data.edges.filter((e) => e.a !== 'linalg' && e.b !== 'linalg');

  const report = mergeSeedAdditions(data);
  assert.equal(report.addedNodes, 1);
  assert.equal(report.refreshedNotes, 0);
  assert.equal(data.nodes.find((n) => n.id === 'calc1').note[0].text, '我的高数笔记');
  assert.ok(data.nodes.find((n) => n.id === 'linalg'));
  assert.ok(data.edges.some((e) => e.a === 'calc1' && e.b === 'linalg'));
  assert.equal(data.contentVersion, CONTENT_VERSION);
});

test('serializeData 输出干净结构（数字取整、笔记保留层级）', () => {
  const data = new KnowledgeIndex().rebuild(normalizeData(createDefaultData()));
  const out = serializeData(data, { x: 1.23456, y: -2.5, scale: 0.8123456 });
  assert.equal(out.version, 3);
  assert.deepEqual(out.view, { x: 1, y: -2, scale: 0.812 });
  assert.equal(out.nodes.length, 10);
  assert.ok(!('deg' in out.nodes[0]));
  assert.ok(Array.isArray(out.nodes[0].note[0].children));
});

test('mastery 掌握标记可往返持久化', () => {
  const data = createDefaultData();
  data.mastery = { nb_a: true, nb_b: false, nb_c: true };
  const out = serializeData(data, null);
  assert.deepEqual(out.mastery, { nb_a: true, nb_c: true });
  const round = normalizeData(out);
  assert.deepEqual(round.mastery, { nb_a: true, nb_c: true });
});

test('appearance 颜色配置可往返，并保留课程覆盖', () => {
  const data = createDefaultData();
  data.appearance.defaultColor = '#112233';
  data.appearance.masteredColor = '#ffb300';
  data.appearance.courses = { calc1: { defaultColor: '#00ff00' } };
  const out = serializeData(data, null);
  assert.deepEqual(out.appearance, data.appearance);
  const round = normalizeData(out);
  assert.deepEqual(round.appearance, data.appearance);
});

test('外观默认色升级：旧默认值迁移为纯白与琥珀色', () => {
  const data = createDefaultData();
  data.appearance.defaultColor = '#e4f2ff';
  data.appearance.masteredColor = '#ffbe4e';
  const round = normalizeData(serializeData(data, null));
  assert.equal(round.appearance.defaultColor, '#ffffff');
  assert.equal(round.appearance.masteredColor, '#ffa200');
});

test('appearance 节点/脉冲比例可持久化并限幅', () => {
  const data = createDefaultData();
  data.appearance.nodeBrightness = 0.7;
  data.appearance.nodeSize = 1.25;
  data.appearance.nodeStarSize = 1.4;
  data.appearance.pulseBrightness = 1.5;
  data.appearance.pulseSize = 0.8;
  const out = serializeData(data, null);
  assert.deepEqual(
    {
      nodeBrightness: out.appearance.nodeBrightness,
      nodeSize: out.appearance.nodeSize,
      nodeStarSize: out.appearance.nodeStarSize,
      pulseBrightness: out.appearance.pulseBrightness,
      pulseSize: out.appearance.pulseSize
    },
    { nodeBrightness: 0.7, nodeSize: 1.25, nodeStarSize: 1.4, pulseBrightness: 1.5, pulseSize: 0.8 }
  );
  out.appearance.nodeBrightness = 9;
  out.appearance.nodeSize = 0.1;
  const round = normalizeData(out);
  assert.equal(round.appearance.nodeBrightness, 1.8);
  assert.equal(round.appearance.nodeSize, 0.4);
});

test('外观滑杆基准升级：旧绝对倍率换算成相对值', () => {
  const legacy = createDefaultData();
  legacy.version = 2;
  legacy.appearance = {
    defaultColor: '#ffffff',
    masteredColor: '#ffa200',
    nodeBrightness: 1.8,
    nodeSize: 1.19,
    pulseBrightness: 1.61,
    pulseSize: 0.8,
    courses: {}
  };
  const out = normalizeData(legacy);
  assert.equal(out.version, 3);
  assert.equal(out.migrated, true);
  assert.deepEqual(
    {
      nodeBrightness: out.appearance.nodeBrightness,
      nodeSize: out.appearance.nodeSize,
      nodeStarSize: out.appearance.nodeStarSize,
      pulseBrightness: out.appearance.pulseBrightness,
      pulseSize: out.appearance.pulseSize
    },
    { nodeBrightness: 1, nodeSize: 1, nodeStarSize: 1, pulseBrightness: 1, pulseSize: 1 }
  );
});

test('KnowledgeIndex 建立邻居索引与尺寸', () => {
  const data = createDefaultData();
  const index = new KnowledgeIndex();
  index.rebuild(data);
  const calc = index.getNode('calc1');
  assert.ok(calc.deg >= 2);
  assert.equal(index.edgesOf('calc1').length, calc.deg);
  assert.ok(index.selectionSetOf('calc1').has('calc1'));
  assert.equal(index.membersOf('math').length, 3);
  assert.ok(Math.abs(calc.r - (3.9 + Math.min(calc.deg, 7) * 0.46)) < 1e-9);
});

test('ensureAnchors / ensurePositions 补全缺失坐标', () => {
  const data = normalizeData({
    nodes: [{ id: 'a', name: 'A', cat: 'math', x: null, y: null }],
    categories: [{ id: 'math', name: '数学基础', anchor: null }]
  });
  ensureAnchors(data);
  assert.deepEqual(data.categories[0].anchor, [0, 0]);
  const missing = ensurePositions(data, new Map(data.categories.map((c) => [c.id, c])), randRange);
  assert.equal(missing, 1);
  assert.ok(Number.isFinite(data.nodes[0].x));
});

test('搜索同时覆盖名称、简介、笔记与分类名', () => {
  const data = createDefaultData();
  const index = new KnowledgeIndex();
  index.rebuild(data);
  assert.ok(matchNodeIds(data.nodes, index.catMap, '拉格朗日').size >= 1);
  assert.ok(matchNodeIds(data.nodes, index.catMap, '线性代数').has('linalg'));
  assert.ok(matchNodeIds(data.nodes, index.catMap, '数学基础').size >= 3);
  const hits = searchNodes(data.nodes, index.catMap, '泰勒');
  assert.equal(hits[0].node.id, 'calc1');
  assert.equal(bestMatch(data.nodes, matchNodeIds(data.nodes, index.catMap, '数学')).name !== undefined, true);
});

test('编辑动作：关系清洗、替换、分类裁剪、重名判断', () => {
  const ids = new Set(['a', 'b', 'c']);
  const cleaned = sanitizeRelations(
    [
      { other: 'a', label: '' },
      { other: 'a', label: '重复' },
      { other: 'b', label: ' 基础 ' },
      { other: 'ghost', label: 'x' }
    ],
    'a',
    ids
  );
  assert.deepEqual(cleaned, [{ other: 'b', label: '基础' }]);

  const edges = replaceNodeEdges(
    [
      { a: 'a', b: 'b', label: '旧' },
      { a: 'b', b: 'c', label: '保留' }
    ],
    'a',
    [{ other: 'c', label: '新' }]
  );
  assert.equal(edges.length, 2);
  assert.ok(edges.every((e) => !(e.a === 'a' && e.b === 'b')));

  const pruned = pruneEmptyCategories(
    [
      { id: 'math', name: '数学基础' },
      { id: 'custom', name: '空分类' }
    ],
    [{ cat: 'math' }],
    ['math']
  );
  assert.deepEqual(pruned.categories.map((c) => c.id), ['math']);

  const node = buildNode({ name: '  新   节点 ', catId: 'math', desc: 'x', x: 1, y: 2, now: 0 });
  assert.equal(node.name, '新 节点');
  assert.equal(nameTaken([node], '新 节点'), true);
  assert.equal(nameTaken([node], '新 节点', node.id), false);
});

test('pickNewNodePosition 优先双击位置，其次关联重心', () => {
  const nodeMap = new Map([
    ['a', { x: 100, y: 100 }],
    ['b', { x: 200, y: 100 }]
  ]);
  assert.deepEqual(
    pickNewNodePosition({ pendingPos: [7, 8], relations: [], nodeMap, anchor: [0, 0] }),
    [7, 8]
  );
  const mid = pickNewNodePosition({
    pendingPos: null,
    relations: [{ other: 'a' }, { other: 'b' }],
    nodeMap,
    anchor: [0, 0]
  });
  assert.ok(Math.abs(mid[0] - 150) <= 55);
});

test('panelFocusCamera 把节点放到左侧可视区中央', () => {
  const cam = panelFocusCamera({
    node: { x: 500, y: 200 },
    viewport: { w: 1600, h: 900 },
    cam: { x: 0, y: 0, scale: 0.74 }
  });
  assert.equal(cam.scale, 0.92);
  const sx = (cam.x - 0) * 0 + (500 - cam.x) * cam.scale + 1600 / 2;
  assert.ok(sx < 800);
  assert.ok(Number.isFinite(cam.y));
});

test('力导向：预热后节点不重叠、包围盒稳定', () => {
  const data = new KnowledgeIndex().rebuild(normalizeData(createDefaultData()));
  ensureAnchors(data);
  const catMap = new Map(data.categories.map((c) => [c.id, c]));
  ensurePositions(data, catMap, randRange);
  warmup(data, data.edges, catMap, 360);
  let minGap = Infinity;
  for (let i = 0; i < data.nodes.length; i++) {
    for (let j = i + 1; j < data.nodes.length; j++) {
      const a = data.nodes[i];
      const b = data.nodes[j];
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  assert.ok(minGap >= 70, 'min gap ' + minGap);
  const bounds = layoutBounds(data.nodes);
  assert.ok(bounds.width > 200 && bounds.height > 140);
  simulateStep(data, data.edges, catMap, 0.9);
  assert.ok(Number.isFinite(data.nodes[0].x));
});

test('LocalStorageBackend：首次打开给种子，之后读存档并升级', async () => {
  const store = new Map();
  const fake = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const backend = new LocalStorageBackend({ storage: fake });
  const first = await backend.load();
  assert.equal(first.firstRun, true);
  assert.equal(first.data.nodes.length, 10);

  const legacy = {
    version: 2,
    categories: [],
    nodes: [{ id: 'x', name: '旧节点', cat: 'math', desc: '旧简介' }],
    edges: []
  };
  store.set('starmap.knowledge.v1', JSON.stringify(legacy));
  const upgraded = await backend.load();
  assert.equal(upgraded.source, 'storage');
  assert.equal(upgraded.seeded, true);
  assert.equal(upgraded.migrated, true);
  assert.ok(upgraded.data.nodes.length >= 10);

  store.set('starmap.knowledge.v1', '{坏的 JSON');
  const broken = await backend.load();
  assert.equal(broken.missing, true);
  assert.equal(broken.data.nodes.length, 10);
});

test('MemoryBackend 可存取往返', async () => {
  const backend = new MemoryBackend();
  const first = await backend.load();
  first.data.nodes.push(buildNode({ name: '新', catId: 'math', desc: '', x: 0, y: 0, now: 0 }));
  await backend.save(serializeData(first.data));
  const again = await backend.load();
  assert.equal(again.data.nodes.length, 11);
  assert.equal(again.firstRun, false);
});