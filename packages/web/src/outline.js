// 多级标题索引：一级课程 → 二级章节（笔记根条目）→ 三级知识点（所有子条目）。
// 笔记块 id 是稳定主键，标题关系（topicEdges）直接引用 `h:<blockId>`。
import { data } from './store.js';

let cache = null;



function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function addTo(list, node) {
  list.push(node);
  return node;
}

function build() {
  const all = [];
  const byId = new Map();
  const courses = [];
  const chaptersByCourse = new Map();
  const pointsByChapter = new Map();
  const hierarchy = [];

  const ensure = (node) => {
    addTo(all, node);
    byId.set(node.id, node);
    return node;
  };

  for (const course of data.nodes) {
    const c = ensure({
      id: course.id,
      level: 1,
      kind: 'course',
      name: course.name,
      label: course.name,
      parentId: null,
      courseId: course.id,
      hostId: course.id,
      blockId: null,
      cat: course.cat,
      desc: course.desc || '',
      node: course,
      children: []
    });
    courses.push(c);
    const chapters = [];
    chaptersByCourse.set(c.id, chapters);

    (course.note || []).forEach((block, index) => {
      if (!block || !block.id) return;
      const chapter = ensure({
        id: `h:${block.id}`,
        level: 2,
        kind: 'chapter',
        name: clean(block.text) || '未命名章节',
        label: clean(block.text) || '未命名章节',
        parentId: c.id,
        courseId: c.id,
        hostId: c.id,
        blockId: block.id,
        block,
        cat: course.cat,
        order: index,
        children: []
      });
      c.children.push(chapter.id);
      chapters.push(chapter);
      hierarchy.push({ a: c.id, b: chapter.id, kind: 'chapter', label: '' });

      const points = [];
      pointsByChapter.set(chapter.id, points);
      const walk = (parentBlock, parentHeading) => {
        for (const child of parentBlock.children || []) {
          if (!child || !child.id) continue;
          const point = ensure({
            id: `h:${child.id}`,
            level: 3,
            kind: 'point',
            name: clean(child.text) || '未命名知识点',
            label: clean(child.text) || '未命名知识点',
            parentId: parentHeading.id,
            chapterId: chapter.id,
            courseId: c.id,
            hostId: c.id,
            blockId: child.id,
            block: child,
            cat: course.cat,
            depth: parentHeading === chapter ? 0 : (Number(parentHeading.depth) || 0) + 1,
            children: []
          });
          parentHeading.children.push(point.id);
          chapter.children.push(point.id);
          points.push(point);
          hierarchy.push({ a: parentHeading.id, b: point.id, kind: 'point', label: '' });
          walk(child, point);
        }
      };
      walk(block, chapter);
    });
  }

  const topicEdges = [];
  for (const raw of data.topicEdges || []) {
    if (!raw) continue;
    const a = byId.get(String(raw.a));
    const b = byId.get(String(raw.b));
    if (!a || !b || a.id === b.id) continue;
    topicEdges.push({ a: a.id, b: b.id, label: String(raw.label || '相关'), kind: 'topic' });
  }

  return {
    all,
    byId,
    courses,
    chaptersByCourse,
    pointsByChapter,
    hierarchy,
    topicEdges,
    crossEdges: [],
    chapterCount: all.filter((n) => n.level === 2).length,
    pointCount: all.filter((n) => n.level === 3).length
  };
}

/** 当前数据对应的多级标题索引（首次访问时构建）。 */
export function getOutline() {
  if (!cache) cache = build();
  return cache;
}

/** 数据或笔记文本变化后调用（下一次 getOutline 重新构建）。 */
export function refreshOutline() {
  cache = null;
}

export function getEntity(id) {
  return getOutline().byId.get(String(id)) || null;
}

export function courseOf(id) {
  const entity = getEntity(id);
  return entity ? getOutline().byId.get(entity.courseId) : null;
}

export function chaptersOf(courseId) {
  return getOutline().chaptersByCourse.get(String(courseId)) || [];
}

export function pointsOf(chapterId) {
  return getOutline().pointsByChapter.get(String(chapterId)) || [];
}

export function childrenOf(id) {
  const entity = getEntity(id);
  if (!entity) return [];
  const o = getOutline();
  return (entity.children || []).map((childId) => o.byId.get(childId)).filter(Boolean);
}

/** 当前实体在标题树中的路径（课程 → 章节 → 知识点）。 */
export function pathOf(id) {
  const out = [];
  let entity = getEntity(id);
  while (entity) {
    out.unshift(entity);
    entity = entity.parentId ? getEntity(entity.parentId) : null;
  }
  return out;
}

export function topicEdgesFor(id) {
  return getOutline().topicEdges.filter((e) => e.a === id || e.b === id);
}

export function topicEdgeLabel(a, b) {
  const edge = getOutline().topicEdges.find(
    (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)
  );
  return edge ? edge.label : '';
}

/** 标题级关系去重键（无向）。 */
export function topicKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}