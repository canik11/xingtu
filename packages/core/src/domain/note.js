// 大纲笔记的数据层：与 UI 完全解耦的纯函数。
// 编辑器（web）只负责把 DOM 光标映射成块 id + 偏移量，结构操作都在这里完成。
import { uid } from '../shared/utils.js';
import { LIMITS } from '../constants.js';

/**
 * 创建一个笔记块。id 可显式传入：存档里的标题节点关系依赖稳定的块 id。
 * @param {unknown} text
 * @param {Array} [children]
 * @param {boolean} [collapsed]
 * @param {unknown} [id]
 * @returns {import('../types.js').NoteBlock}
 */
export function makeNoteBlock(text, children, collapsed, id) {
  const keep = typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
  return {
    id: keep || uid('nb'),
    text: String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, LIMITS.noteText),
    collapsed: !!collapsed,
    children: Array.isArray(children) ? children : []
  };
}

/**
 * 把紧凑的种子写法转成块树。支持四种形态：
 *   '文本'                        叶子
 *   ['文本', [子级...]]           带子级（['文本'] 等于叶子）
 *   { _c: [[a, [子级]], ...] }    同级并列的多个条目（避免「第一个是文本、其余是子级」的歧义）
 *   { text, children, collapsed } 完整对象
 * @param {unknown} source
 * @returns {import('../types.js').NoteBlock[]}
 */
export function makeNote(source) {
  if (!Array.isArray(source)) return [];

  const walk = (list, depth) => {
    if (!Array.isArray(list) || depth > LIMITS.noteDepth) return [];
    const blocks = [];
    for (const item of list) {
      if (blocks.length >= LIMITS.noteBreadth) break;

      if (Array.isArray(item)) {
        // 紧凑写法 ['文本', [子级...]]
        const text = typeof item[0] === 'string' ? item[0] : '';
        const rawKids = item[1];
        const isGroup = rawKids && typeof rawKids === 'object' && Array.isArray(rawKids._c);
        const built = walk(
          isGroup ? rawKids._c : Array.isArray(rawKids) ? rawKids : [],
          depth + 1
        );
        if (text.trim() || built.length) blocks.push(makeNoteBlock(text, built));
        continue;
      }

      if (item && typeof item === 'object' && Array.isArray(item._c)) {
        // 并列分组：展开成同级条目
        for (const sub of item._c) {
          if (blocks.length >= LIMITS.noteBreadth) break;
          blocks.push(...walk([sub], depth));
        }
        continue;
      }

      if (typeof item === 'string') {
        if (item.trim()) blocks.push(makeNoteBlock(item, []));
        continue;
      }

      if (item && typeof item === 'object') {
        const kids = Array.isArray(item.children) ? walk(item.children, depth + 1) : [];
        if (String(item.text || '').trim() || kids.length) {
          blocks.push(makeNoteBlock(item.text, kids, item.collapsed, item.id));
        }
      }
    }
    return blocks;
  };
  return walk(source, 0);
}

/**
 * 规范化外部传入的笔记（导入文件、旧存档）。
 * @param {unknown} source
 * @returns {import('../types.js').NoteBlock[]}
 */
export function normalizeNote(source) {
  return makeNote(source);
}

/**
 * 旧版本没有笔记时，把简介按「- 」条目转成扁平大纲，避免信息丢失。
 * @param {string} desc
 * @returns {import('../types.js').NoteBlock[]}
 */
export function noteFromDesc(desc) {
  const lines = String(desc || '').split(/\r?\n/);
  const blocks = [];
  const intro = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) blocks.push(makeNoteBlock(bullet[1], []));
    else if (!blocks.length) intro.push(line);
    else blocks.push(makeNoteBlock(line, []));
  }
  if (intro.length) blocks.unshift(makeNoteBlock(intro.join(' '), []));
  return blocks;
}

/**
 * 统计块总数（含所有层级）。
 * @param {import('../types.js').NoteBlock[]} note
 * @returns {number}
 */
export function countNote(note) {
  let total = 0;
  const walk = (list) => {
    for (const block of list || []) {
      total++;
      walk(block.children);
    }
  };
  walk(note);
  return total;
}

/**
 * 把整棵大纲拍平成一段文本，用于搜索与简介预览。
 * @param {import('../types.js').NoteBlock[]} note
 * @returns {string}
 */
export function noteToText(note) {
  const parts = [];
  const walk = (list) => {
    for (const block of list || []) {
      if (block.text) parts.push(block.text);
      walk(block.children);
    }
  };
  walk(note);
  return parts.join(' ');
}

/**
 * 深拷贝笔记。保留块 id，这样标题关系在导入/导出后仍然有效。
 * @param {import('../types.js').NoteBlock[]} note
 * @returns {Array<{id:string, text:string, collapsed:boolean, children:Array}>}
 */
export function cloneNote(note) {
  return (note || []).map((block) => ({
    id: block.id,
    text: block.text,
    collapsed: !!block.collapsed,
    children: cloneNote(block.children)
  }));
}

/**
 * 在树上定位块。
 * @param {import('../types.js').NoteBlock[]} list
 * @param {string} id
 * @param {import('../types.js').NoteBlock|null} [parentBlock]
 * @returns {{block: import('../types.js').NoteBlock, list: import('../types.js').NoteBlock[], index: number, parent: import('../types.js').NoteBlock|null}|null}
 */
export function findNoteEntry(list, id, parentBlock) {
  for (let i = 0; i < list.length; i++) {
    const block = list[i];
    if (block.id === id) return { block, list, index: i, parent: parentBlock || null };
    const hit = findNoteEntry(block.children || [], id, block);
    if (hit) return hit;
  }
  return null;
}

/**
 * 在整个项目的多个知识点笔记里定位一个块，返回它所属的节点与所在列表。
 * 全局大纲的跨节点拖拽需要知道块属于哪个 node.note。
 * @param {Array<{id:string,note?:Array}>} nodes
 * @param {string} blockId
 */
export function findBlockOwner(nodes, blockId) {
  for (const node of nodes || []) {
    const entry = findNoteEntry(node.note || [], blockId);
    if (entry) return { ...entry, node };
  }
  return null;
}

/** targetId 是否是 block 的后代（用于阻止把父块拖进自己的子树）。 */
export function isBlockDescendant(block, targetId) {
  if (!block || !targetId) return false;
  for (const child of block.children || []) {
    if (child.id === targetId || isBlockDescendant(child, targetId)) return true;
  }
  return false;
}

/**
 * 跨知识点移动一个笔记块（连同子级）。
 * targetParentId 为空表示放到目标节点的根级；否则挂到目标块的子级。
 * targetIndex 是插入位置（按目标列表的原顺序），越界会收敛到末尾。
 * 返回 false 表示目标非法、父块不存在，或试图移到自己的后代里。
 * @returns {{ok:boolean, reason?:string, block?:object, nodeId?:string, parentId?:string|null, index?:number}}
 */
export function moveNoteBlock(nodes, blockId, targetNodeId, targetParentId, targetIndex) {
  const source = findBlockOwner(nodes, blockId);
  if (!source) return { ok: false, reason: 'missing-block' };
  const targetNode = (nodes || []).find((node) => node.id === targetNodeId);
  if (!targetNode) return { ok: false, reason: 'missing-node' };

  if (targetParentId) {
    if (targetParentId === blockId) return { ok: false, reason: 'self' };
    if (isBlockDescendant(source.block, targetParentId)) {
      return { ok: false, reason: 'descendant' };
    }
  }

  const parentEntry = targetParentId ? findNoteEntry(targetNode.note || [], targetParentId) : null;
  if (targetParentId && !parentEntry) return { ok: false, reason: 'missing-parent' };
  const targetList = parentEntry ? parentEntry.block.children : targetNode.note;
  if (!Array.isArray(targetList)) return { ok: false, reason: 'invalid-target' };

  let index = Number.isInteger(targetIndex) ? targetIndex : targetList.length;
  index = Math.max(0, Math.min(targetList.length, index));
  // 同一个列表里向下移动时，移除源块会让目标位置前移一格。
  if (source.list === targetList && source.index < index) index -= 1;

  source.list.splice(source.index, 1);
  targetList.splice(index, 0, source.block);
  if (parentEntry) parentEntry.block.collapsed = false;
  return {
    ok: true,
    block: source.block,
    nodeId: targetNode.id,
    parentId: parentEntry ? parentEntry.block.id : null,
    index
  };
}

/** 新建一个空块并追加到根级，返回块（由调用方负责重渲染与聚焦）。 */
export function appendRootBlock(note) {
  const block = makeNoteBlock('', []);
  note.push(block);
  return block;
}

/**
 * 在光标处把一条拆成两条：前半段留在原块，后半段成为同级新块。
 * @param {import('../types.js').NoteBlock[]} note
 * @param {string} blockId
 * @param {number} offset 光标在纯文本中的位置
 * @param {string} fullText 该块当前完整文本（来自 DOM）
 * @returns {import('../types.js').NoteBlock|null} 新块
 */
export function splitBlock(note, blockId, offset, fullText) {
  const entry = findNoteEntry(note, blockId);
  if (!entry) return null;
  const text = String(fullText == null ? entry.block.text : fullText).replace(/\u00a0/g, ' ');
  const at = Math.max(0, Math.min(text.length, offset));
  entry.block.text = text.slice(0, at).slice(0, LIMITS.noteText);
  const block = makeNoteBlock(text.slice(at), []);
  entry.list.splice(entry.index + 1, 0, block);
  return block;
}

/**
 * 缩进：成为上一个同级条目的最后一名子级。
 * @returns {{ok:boolean, reason?:string, blockId?:string}}
 */
export function indentBlock(note, blockId) {
  const entry = findNoteEntry(note, blockId);
  if (!entry) return { ok: false, reason: 'missing' };
  if (entry.index === 0) return { ok: false, reason: 'first' };
  const prev = entry.list[entry.index - 1];
  entry.list.splice(entry.index, 1);
  prev.children = prev.children || [];
  prev.children.push(entry.block);
  prev.collapsed = false;
  return { ok: true, blockId: entry.block.id };
}

/**
 * 反缩进：升到父条目之后。
 * @returns {{ok:boolean, reason?:string, blockId?:string}}
 */
export function outdentBlock(note, blockId) {
  const entry = findNoteEntry(note, blockId);
  if (!entry) return { ok: false, reason: 'missing' };
  if (!entry.parent) return { ok: false, reason: 'root' };
  const parentEntry = findNoteEntry(note, entry.parent.id);
  if (!parentEntry) return { ok: false, reason: 'missing' };
  entry.list.splice(entry.index, 1);
  parentEntry.list.splice(parentEntry.index + 1, 0, entry.block);
  return { ok: true, blockId: entry.block.id };
}

/**
 * 删除一个空块，返回下一个应该聚焦的块 id。只剩一块时改为清空文本。
 * @returns {{ok:boolean, focusId:string|null, emptied?:boolean}}
 */
export function removeBlock(note, blockId) {
  const entry = findNoteEntry(note, blockId);
  if (!entry) return { ok: false, focusId: null };
  if (countNote(note) <= 1) {
    entry.block.text = '';
    return { ok: true, focusId: entry.block.id, emptied: true };
  }
  let focusId = null;
  const prev = entry.list[entry.index - 1];
  if (prev) {
    let deep = prev;
    while (deep.children && deep.children.length && !deep.collapsed) {
      deep = deep.children[deep.children.length - 1];
    }
    focusId = deep.id;
  } else if (entry.parent) {
    focusId = entry.parent.id;
  } else {
    const next = entry.list[entry.index + 1];
    focusId = next ? next.id : null;
  }
  entry.list.splice(entry.index, 1);
  return { ok: true, focusId };
}

/**
 * 切换折叠状态，返回新的折叠值（没有子级时返回 null）。
 * @returns {boolean|null}
 */
export function toggleBlock(note, blockId) {
  const entry = findNoteEntry(note, blockId);
  if (!entry || !entry.block.children || !entry.block.children.length) return null;
  entry.block.collapsed = !entry.block.collapsed;
  return entry.block.collapsed;
}

/**
 * 粘贴多行文本：第一行接到光标位置，其余行作为同级新块插入。
 * @param {import('../types.js').NoteBlock[]} note
 * @param {string} blockId
 * @param {number} offset
 * @param {string} fullText 当前完整文本
 * @param {string} raw 剪贴板纯文本
 * @returns {{ok:boolean, focusId:string|null, focusPos:'start'|'end'|number}}
 */
export function pasteIntoNote(note, blockId, offset, fullText, raw) {
  const entry = findNoteEntry(note, blockId);
  if (!entry) return { ok: false, focusId: null, focusPos: 'end' };
  const full = String(fullText == null ? entry.block.text : fullText).replace(/\u00a0/g, ' ');
  const at = Math.max(0, Math.min(full.length, offset));
  const lines = String(raw || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trimEnd());
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { ok: false, focusId: blockId, focusPos: at };

  if (lines.length === 1) {
    entry.block.text = (full.slice(0, at) + lines[0] + full.slice(at)).slice(0, LIMITS.noteText);
    return { ok: true, focusId: blockId, focusPos: at + lines[0].length };
  }

  entry.block.text = (full.slice(0, at) + lines[0]).slice(0, LIMITS.noteText);
  let cursor = entry.index;
  let lastId = entry.block.id;
  for (let i = 1; i < lines.length; i++) {
    const lineText = i === lines.length - 1 ? lines[i] + full.slice(at) : lines[i];
    const block = makeNoteBlock(lineText, []);
    entry.list.splice(cursor + 1, 0, block);
    cursor++;
    lastId = block.id;
  }
  return { ok: true, focusId: lastId, focusPos: 'end' };
}

/**
 * 把纯文本（含 - 列表、缩进）解析成大纲，用于「粘贴导入」。
 * @param {string} text
 * @returns {import('../types.js').NoteBlock[]}
 */
export function noteFromText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const root = [];
  /** @type {{indent:number, children:import('../types.js').NoteBlock[]}[]} */
  const stack = [{ indent: -1, children: root }];
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const cleaned = line.trim().replace(/^[-*•]\s+/, '');
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    const block = makeNoteBlock(cleaned, []);
    parent.children.push(block);
    stack.push({ indent, children: block.children });
  }
  return root;
}