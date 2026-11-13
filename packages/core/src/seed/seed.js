// 公开演示种子：数据本体与模型放在一起，构建时内联进单文件产物。
// 用户可以把「知识库路径」指向自己的 JSON；私人的完整知识库不进入公开构建。
import seedSource from './seed.json' with { type: 'json' };

export const DEFAULT_CATEGORIES = (seedSource.categories || []).map((c) => ({
  id: c.id,
  name: c.name,
  anchor: Array.isArray(c.anchor) ? c.anchor.slice() : null
}));

/** 内置分类 id：清理空分类时这些始终保留。 */
export const BUILTIN_CATEGORY_IDS = DEFAULT_CATEGORIES.map((c) => c.id);

export const DEFAULT_NODES = (seedSource.nodes || []).map((n) => ({
  id: n.id,
  name: n.name,
  cat: n.cat,
  x: n.x,
  y: n.y,
  desc: n.desc,
  note: n.note
}));

export const DEFAULT_EDGES = (seedSource.edges || []).map((e) => [e.a, e.b, e.label]);

export const CATEGORY_COLORS = ['#9db9ff', '#8fd6cf', '#b9a8ff', '#9cc9ee', '#c2a9ff', '#8ecffc', '#ffd9a3', '#f0b9d8'];