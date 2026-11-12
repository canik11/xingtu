/**
 * @typedef {Object} NoteBlock
 * @property {string} id      块 id，纯 UI 用途（聚焦、定位）
 * @property {string} text    纯文本内容（不含换行）
 * @property {boolean} collapsed 是否有子级且被折叠
 * @property {NoteBlock[]} children 子级块
 */

/**
 * @typedef {Object} KnowledgeNode
 * @property {string} id
 * @property {string} name
 * @property {string} cat        分类 id
 * @property {string} desc       一句话简介
 * @property {NoteBlock[]} note  大纲笔记
 * @property {number|null} x     世界坐标
 * @property {number|null} y
 */

/**
 * @typedef {Object} KnowledgeEdge
 * @property {string} a
 * @property {string} b
 * @property {string} label 关系说明，如「基础」
 */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {[number, number]|null} anchor 力导向中的引力中心
 */

/**
 * @typedef {Object} KnowledgeData
 * @property {number} version
 * @property {number} contentVersion
 * @property {Category[]} categories
 * @property {KnowledgeNode[]} nodes
 * @property {KnowledgeEdge[]} edges
 * @property {{x:number,y:number,scale:number}|null} view
 */

export {};