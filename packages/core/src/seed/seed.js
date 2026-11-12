// 公开演示种子：数据本体存放在仓库根 knowledge/seed.json（用户的知识库文件夹）。
// 用户可以直接编辑该文件，或在设置里把知识库路径指向自己的 JSON。
// 私人的完整知识库不进入这个文件，也不进入公开构建。
import seedSource from '../../../../knowledge/seed.json' with { type: 'json' };

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