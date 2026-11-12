// @starmap/core —— 知识星图的数据与算法内核（零 DOM、零 Browser API）。
//
// 分层：
//   constants / shared   常量与通用工具
//   seed                 内置知识库种子
//   domain               笔记树、数据模型、编辑动作、索引
//   layout               力导向布局
//   search               搜索
//   storage              存储后端（浏览器 localStorage / HTTP / 内存）
//
// 任何 UI（Web、桌面端、CLI 工具）都只依赖这一层，保证内核可单测、可复用。
export * from './constants.js';
export * from './shared/utils.js';
export * from './domain/note.js';
export * from './domain/model.js';
export * from './domain/edits.js';
export * from './domain/indexes.js';
export * from './layout/force.js';
export * from './search/search.js';
export * from './storage/local.js';
export { DEFAULT_CATEGORIES, DEFAULT_EDGES, DEFAULT_NODES, CATEGORY_COLORS, BUILTIN_CATEGORY_IDS } from './seed/seed.js';