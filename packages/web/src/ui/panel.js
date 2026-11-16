// 详情面板：查看（笔记 / 关联双页签）、编辑资料、大纲笔记编辑。
// 渲染 HTML + 写回数据；键盘与输入行为集中在 bindNoteEditing。
import {
  countNote,
  findNoteEntry,
  makeNoteBlock,
  makeNote,
  noteToText,
  appendRootBlock,
  splitBlock,
  indentBlock,
  outdentBlock,
  removeBlock,
  toggleBlock
} from '@starmap/core';
import { clamp } from '@starmap/core';
import { el, esc, closest, setDockVisible } from '../lib/dom.js';
import { ui, view } from '../state.js';
import { data, index, scheduleSave } from '../store.js';
import { center3DScene } from '../camera.js';
import { onPanelGeometryChanged } from '../navigation.js';
import { fitFocus, rebuildFocus } from '../focus.js';
import {
  getEntity,
  getOutline,
  courseOf,
  pathOf,
  pointsOf,
  topicEdgesFor,
  topicKey,
  refreshOutline
} from '../outline.js';
import * as sfx from '../audio/sfx.js';
import { catColor } from '../scene/renderer.js';
import { masteryFor, isMastered, toggleMastery, isLeafBlock } from '../mastery.js';
import { toast } from './feedback.js';
import { refreshCategoryDatalist } from './datalist.js';
import { renderRelations, wireRelEditor } from './relation-editor.js';
import { enterEdit, isEditing, setEditing, cancelEdit, editState, hasEditChanges } from './edit-form.js';
import { askConfirm } from './confirm.js';
import { runAction } from '../actions.js';

let panelOpen = false;

/** 面板是否打开。 */
export function isPanelOpen() {
  return panelOpen;
}

/** 把侧栏宽度同步到 CSS 变量。 */
export function applyPanelWidth() {
  // 不再限制在一半屏以内：手动拖宽可以一直到整个视口；全屏按钮再单独覆盖。
  const max = Math.max(320, view.w);
  ui.panelWidth = clamp(Number(ui.panelWidth) || 430, 320, max);
  document.documentElement.style.setProperty('--panel-w', `${Math.round(ui.panelWidth)}px`);
  if (el.panel) el.panel.style.setProperty('--panel-w', `${Math.round(ui.panelWidth)}px`);
}

/** 收起侧栏，保留右缘的展开按钮。 */
export function setPanelFull(full) {
  if (!panelOpen) return;
  ui.panelFull = !!full;
  el.panel.classList.toggle('full', ui.panelFull);
  document.body.classList.toggle('panel-full', ui.panelFull);
  el.panel.querySelectorAll('[data-act="fullscreen"]').forEach((btn) => {
    btn.textContent = ui.panelFull ? '⤡' : '⛶';
    btn.title = ui.panelFull ? '退出全屏' : '全屏编辑';
    btn.setAttribute('aria-label', ui.panelFull ? '退出全屏' : '全屏编辑');
    btn.setAttribute('aria-pressed', String(ui.panelFull));
  });
  onPanelGeometryChanged();
}

export function setPanelCollapsed(collapsed) {
  if (!panelOpen) return;
  if (collapsed && ui.panelFull) setPanelFull(false);
  ui.panelCollapsed = !!collapsed;
  el.panel.classList.toggle('collapsed', ui.panelCollapsed);
  document.body.classList.toggle('panel-collapsed', ui.panelCollapsed);
  if (el.panelReveal) {
    el.panelReveal.hidden = !ui.panelCollapsed;
    el.panelReveal.setAttribute('aria-hidden', ui.panelCollapsed ? 'false' : 'true');
  }
  applyPanelWidth();
  onPanelGeometryChanged();
}

/** 笔记块在内部 3D 中双击时，滚动到侧栏中对应的大纲条目。 */
export function revealNoteBlock(blockId) {
  if (!panelOpen || !blockId) return;
  ui.panelTab = 'note';
  switchPanelTab('note');
  requestAnimationFrame(() => {
    const text = noteTextEl(blockId);
    if (!text) return;
    if (text.scrollIntoView) text.scrollIntoView({ block: 'center', behavior: 'smooth' });
    text.classList.add('note-hit');
    window.setTimeout(() => text.classList.remove('note-hit'), 1400);
  });
}

/** 当前面板展示的节点。 */
export function panelNode() {
  return index.getNode(ui.panelNodeId);
}

/**
 * 打开某个知识点的详情面板。
 * @param {string} id
 */
export function openPanel(id) {
  const entity = getEntity(id);
  if (!entity) return;
  const wasOpen = panelOpen;
  const n = entity.node;
  if (ui.selection !== id) ui.panelTab = 'note';
  selectNode(id);
  panelOpen = true;
  ui.panelOpen = true;
  ui.panelCollapsed = false;
  ui.panelFull = false;
  el.panel.classList.remove('full');
  document.body.classList.remove('panel-full');
  ui.panelNodeId = id;
  setEditing(false);
  document.body.classList.add('panel-open');
  document.body.classList.remove('panel-collapsed');
  el.panel.classList.remove('collapsed');
  if (el.panelReveal) el.panelReveal.hidden = true;
  applyPanelWidth();
  el.panel.classList.add('open');
  el.panel.setAttribute('aria-hidden', 'false');
  if (!wasOpen) sfx.panelOpen();
  el.scrim.hidden = false;
  // 强制一次布局，保证后续的过渡动画从 opacity:0 起步。
  void el.scrim.offsetWidth;
  el.scrim.classList.add('show');
  if (entity.level === 1 && n) renderPanelView(n);
  else renderHeadingPanel(entity);
  if (ui.level === 'local') {
    // 局部 3D 图始终以整张图适配可视区，面板宽度通过 camera.panelReserve 留白。
    fitFocus(true);
  } else {
    center3DScene(true, ui.level === 'inner' ? 250 : ui.spherePuffTarget > 0.5 ? 430 : 300);
  }
}

/** 关闭面板。force=true 时跳过“未保存”询问（保存后关闭、删除后关闭用）。 */
export function closePanel(force = false) {
  if (!force && isEditing() && hasEditChanges()) {
    askConfirm({
      title: '有未保存的修改',
      message: '面板里的资料还没保存，关闭前要保存吗？',
      confirmText: '保存并关闭',
      cancelText: '放弃修改',
      danger: false,
      onConfirm: () => {
        runAction('saveEdit');
        // 保存校验没通过（名称为空/重名）时保持面板打开，让用户继续改。
        if (!isEditing()) closePanel(true);
      },
      onCancel: () => {
        // 放弃本次编辑：丢弃表单改动，直接关面板。
        closePanel(true);
      }
    });
    return;
  }
  const wasOpen = panelOpen;
  panelOpen = false;
  ui.panelOpen = false;
  ui.panelCollapsed = false;
  ui.panelFull = false;
  ui.panelNodeId = null;
  setEditing(false);
  document.body.classList.remove('panel-open');
  document.body.classList.remove('panel-collapsed');
  el.panel.classList.remove('open');
  el.panel.classList.remove('collapsed');
  el.panel.classList.remove('full');
  document.body.classList.remove('panel-full');
  el.panel.setAttribute('aria-hidden', 'true');
  if (el.panelReveal) el.panelReveal.hidden = true;
  el.scrim.classList.remove('show');
  el.scrim.hidden = true;
  updateDock();
  if (!wasOpen) return;
  sfx.panelClose();
  if (ui.level === 'local') {
    fitFocus(true);
  } else {
    center3DScene(true, ui.level === 'inner' ? 250 : ui.spherePuffTarget > 0.5 ? 430 : 300);
  }
}

/** 选中节点（课程或标题；null 表示取消）。 */
export function selectNode(id) {
  ui.selection = id && getEntity(id) ? id : null;
  if (!ui.selection) ui.panelNodeId = panelOpen ? ui.panelNodeId : null;
  updateDock();
}

/** 底部 dock 同步。 */
export function updateDock() {
  const entity = ui.selection ? getEntity(ui.selection) : null;
  if (entity) {
    const course = entity.level === 1 ? entity.node : courseOf(entity.id);
    const cat = course ? index.getCategory(course.cat) : null;
    const relCount = entity.level === 1
      ? course ? index.edgesOf(course.id).length : 0
      : topicEdgesFor(entity.id).length;
    el.dockName.textContent = entity.name;
    el.dockMeta.textContent =
      entity.level === 1
        ? `${cat ? cat.name : '未分类'} · ${relCount} 条关联 · ${course ? course.noteCount || 0 : 0} 条笔记`
        : `${course ? course.name : '课程'} · ${entity.level === 2 ? '二级章节' : '三级知识点'} · ${relCount} 条关联`;
    setDockVisible(true);
  } else {
    setDockVisible(false);
  }
}

/** 面板元信息文本。 */
export function panelMetaText(n) {
  const cat = index.getCategory(n.cat);
  const rels = index.edgesOf(n.id).length;
  return `${cat ? cat.name : '未分类'} · ${rels} 条关联 · ${n.noteCount || 0} 条笔记`;
}

/** 一句话简介：支持 `- ` 列表与 `**粗体**`、`` `代码` ``。 */
export function richText(text) {
  if (!text) return '';
  const lines = esc(text).split(/\r?\n/);
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  const inline = (s) =>
    s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      closeList();
      continue;
    }
    if (t.startsWith('- ')) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += '<li>' + inline(t.slice(2)) + '</li>';
    } else {
      closeList();
      html += '<p>' + inline(t) + '</p>';
    }
  }
  closeList();
  return html;
}

/* ---------------------- 大纲笔记渲染 ---------------------- */

function renderNoteBlocks(blocks, depth) {
  return (blocks || [])
    .map((block) => {
      const hasChildren = !!(block.children && block.children.length);
      const collapsed = hasChildren && !!block.collapsed;
      const childCount = collapsed ? countNote(block.children) : 0;
      return `<div class="note-node${collapsed ? ' collapsed' : ''}" data-nid="${esc(block.id)}">
        <div class="note-line">
          ${
            hasChildren
              ? `<button class="note-toggle" type="button" data-act="note-toggle" data-nid="${esc(block.id)}" aria-label="${collapsed ? '展开' : '折叠'}">${collapsed ? '▸' : '▾'}</button>`
              : '<span class="note-toggle leaf" aria-hidden="true"></span>'
          }
          <div class="note-text${block.text ? '' : ' is-empty'}" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="false" data-nid="${esc(block.id)}" data-placeholder="${depth === 0 ? '开始记录…' : '新条目…'}">${esc(block.text)}</div>
          ${collapsed ? `<span class="note-count" title="${childCount} 条子笔记">${childCount}</span>` : ''}
        </div>
        ${hasChildren ? `<div class="note-children">${renderNoteBlocks(block.children, depth + 1)}</div>` : ''}
      </div>`;
    })
    .join('');
}

function noteAreaHtml(n) {
  return `<div class="note-toolbar">
      <span>点击条目编辑 · Enter 新条目 · Tab 缩进</span>
      <span>自动保存</span>
    </div>
    ${
      n.note.length
        ? `<div class="note-editor" id="noteEditor">${renderNoteBlocks(n.note, 0)}</div>`
        : `<div class="note-empty" data-act="note-start" role="button" tabindex="0">
          <b>还没有详细笔记</b>
          <span>点击这里开始用大纲记录：定义、关键公式、易错点、资料链接……</span>
        </div>`
    }
    <button class="note-add" type="button" data-act="note-add">＋ 添加条目</button>`;
}

function relListHtml(n) {
  const rels = index.neighborsOf(n.id);
  return rels.length
    ? rels
        .map(
          (r) => `
    <button class="rel-item" type="button" data-act="rel" data-id="${esc(r.other.id)}">
      <span class="rel-name">${esc(r.other.name)}</span>
      <span class="rel-tag">${esc(r.label)}</span>
    </button>`
        )
        .join('')
    : '<div class="rel-empty">还没有建立连接。点击「编辑」为它添加关联，让它汇入星图。</div>';
}

/** 标题节点（二级章节 / 三级知识点）的侧栏：只关心“在哪里”和“连了谁”。 */
function renderHeadingPanel(entity) {
  setEditing(false);
  const course = courseOf(entity.id);
  const rels = topicEdgesFor(entity.id);
  const path = pathOf(entity.id);
  const crumb = path.map((p) => esc(p.name)).join(' / ');
  const cat = course ? index.getCategory(course.cat) : null;
  const color = course ? catColor(course.cat) : '#9fb8e8';

  const options = [];
  for (const c of getOutline().courses) {
    const list = getOutline()
      .all.filter((e) => e.id !== entity.id && e.courseId === c.id)
      .slice(0, 80);
    if (!list.length) continue;
    options.push(
      `<optgroup label="${esc(c.name)}">${list
        .map((e) => `<option value="${esc(e.id)}">${esc(e.level === 1 ? e.name : `  ${e.name}`)}</option>`)
        .join('')}</optgroup>`
    );
  }

  const relHtml = rels.length
    ? rels
        .map((e) => {
          const otherId = e.a === entity.id ? e.b : e.a;
          const other = getEntity(otherId);
          return `<div class="rel-row topic-rel">
            <div class="rel-main"><span class="rel-name">${esc(other ? other.name : otherId)}</span><span class="rel-tag">${esc(e.label || '相关')}</span></div>
            <button class="rel-x" type="button" data-act="remove-topic" data-a="${esc(e.a)}" data-b="${esc(e.b)}" aria-label="删除关系">×</button>
          </div>`;
        })
        .join('')
    : '<div class="rel-empty">还没有跨层级关系。可以从下面选一个标题建立一条光丝。</div>';

  const masteryRatio = masteryFor(entity);
  const masteryPercent = Math.round(masteryRatio * 100);
  const leaf = entity.level === 3 && isLeafBlock(entity.block);
  const masteryHtml = entity.level === 3
    ? (leaf
        ? `<button class="mastery-toggle${isMastered(entity) ? ' on' : ''}" type="button" data-act="toggle-mastery" aria-pressed="${isMastered(entity)}">
        <span class="mastery-box" aria-hidden="true">${isMastered(entity) ? '✓' : ''}</span>
        <span>${isMastered(entity) ? '已掌握' : '标记为已掌握'}</span>
      </button>`
        : `<div class="mastery-progress"><span>本条及子级掌握</span><b>${masteryPercent}%</b></div>
      <p class="field-note">只有最末级条目可以单独勾选；这一条包含子条目，掌握度按子级自动汇总。</p>`)
    : `<div class="mastery-progress"><span>${entity.level === 1 ? '课程掌握' : '本章掌握'}</span><b>${masteryPercent}%</b></div>`;

  let content = '';
  if (entity.level === 2) {
    const pts = pointsOf(entity.id);
    content = pts.length
      ? `<div class="section-label">本章知识点<span>${pts.length}</span></div><div class="rel-list">${pts
          .map((p) => `<div class="rel-row"><span class="rel-name">${esc(p.name)}</span></div>`)
          .join('')}</div>`
      : '';
  } else {
    const text = String(entity.block && entity.block.text ? entity.block.text : '').trim();
    content = text
      ? `<div class="section-label">内容</div><div class="panel-desc">${richText(text)}</div>`
      : '';
  }

  el.panelBody.innerHTML = `
    <div class="panel-head">
      <span class="chip"><i style="--c:${color}"></i>${esc(course ? course.name : '知识星图')}</span>
      <span class="panel-head-actions">
        <button class="panel-icon-btn" type="button" data-act="fullscreen" title="${ui.panelFull ? '退出全屏' : '全屏编辑'}" aria-label="${ui.panelFull ? '退出全屏' : '全屏编辑'}" aria-pressed="${ui.panelFull}">${ui.panelFull ? '⤡' : '⛶'}</button>
        <button class="panel-icon-btn" type="button" data-act="collapse" title="收起侧栏" aria-label="收起侧栏">⇥</button>
        <button class="panel-close" type="button" data-act="close" aria-label="关闭">×</button>
      </span>
    </div>
    <h2 class="panel-title">${esc(entity.name)}</h2>
    <div class="panel-meta">${esc(crumb)} · ${entity.level === 2 ? '二级章节' : '三级知识点'}</div>
    <div class="panel-desc">${entity.level === 2 ? '双击展开本章知识点；任意标题都可以建立跨层级关系。' : '双击查看笔记；可以把它与其他章节、知识点连成一张网。'}</div>
    ${content}
    ${masteryHtml}
    <div class="section-label">跨层级关系<span>${rels.length}</span></div>
    <div class="rel-list">${relHtml}</div>
    <div class="field" style="margin-top:14px">
      <label for="topicTarget">连接到</label>
      <select id="topicTarget">${options.join('')}</select>
    </div>
    <div class="field">
      <label for="topicLabel">关系标签</label>
      <input id="topicLabel" type="text" maxlength="12" placeholder="例如：用到 / 延伸 / 对比" />
    </div>
    <button class="link-btn" type="button" data-act="add-topic">＋ 建立一条关系</button>
  `;
  el.panelFoot.innerHTML = `
    <button class="btn ghost" type="button" data-act="open-course" data-id="${esc(entity.courseId)}">打开所属课程</button>
    <button class="btn primary" type="button" data-act="reveal-note" data-id="${esc(entity.courseId)}" data-block="${esc(entity.blockId || '')}">在笔记中查看</button>
  `;
  el.panelBody.scrollTop = 0;
  refreshCategoryDatalist();
}

function addTopicEdge() {
  const entity = getEntity(ui.panelNodeId);
  if (!entity) return;
  const target = document.getElementById('topicTarget');
  const labelInput = document.getElementById('topicLabel');
  const otherId = target ? target.value : '';
  const other = getEntity(otherId);
  if (!other || other.id === entity.id) {
    toast('请选择另一个标题');
    return;
  }
  const label = (labelInput ? labelInput.value : '').trim() || '相关';
  const key = topicKey(entity.id, other.id);
  const exists = (data.topicEdges || []).some((e) => topicKey(e.a, e.b) === key);
  if (exists) {
    toast('这条关系已经存在');
    return;
  }
  if (!Array.isArray(data.topicEdges)) data.topicEdges = [];
  data.topicEdges.push({ a: entity.id, b: other.id, label });
  scheduleSave();
  refreshOutline();
  rebuildFocus();
  renderHeadingPanel(getEntity(entity.id) || entity);
  toast(`已连接「${other.name}」`);
}

function removeTopicEdge(a, b) {
  const key = topicKey(a, b);
  const before = (data.topicEdges || []).length;
  data.topicEdges = (data.topicEdges || []).filter((e) => topicKey(e.a, e.b) !== key);
  if (data.topicEdges.length === before) return;
  scheduleSave();
  refreshOutline();
  rebuildFocus();
  const entity = getEntity(ui.panelNodeId);
  if (entity) renderHeadingPanel(entity);
  toast('已删除关系');
}

/** 渲染查看态。 */
export function renderPanelView(n) {
  setEditing(false);
  const cat = index.getCategory(n.cat);
  const color = catColor(n.cat);
  const relCount = index.edgesOf(n.id).length;
  const xRels = topicEdgesFor(n.id);
  const courseEntity = getEntity(n.id) || n;
  const masteryPercent = Math.round(masteryFor(courseEntity) * 100);
  const xRelHtml = xRels.length
    ? xRels
        .map((e) => {
          const otherId = e.a === n.id ? e.b : e.a;
          const other = getEntity(otherId);
          return `<div class="rel-row topic-rel"><div class="rel-main"><span class="rel-name">${esc(
            other ? other.name : otherId
          )}</span><span class="rel-tag">${esc(e.label || '相关')}</span></div></div>`;
        })
        .join('')
    : '<div class="rel-empty">还没有跨层级关系。可以从章节或知识点一侧把课程连进来。</div>';

  el.panelBody.innerHTML = `
    <div class="panel-head">
      <span class="chip"><i style="--c:${color}"></i>${esc(cat ? cat.name : '未分类')}</span>
      <span class="panel-head-actions">
        <button class="panel-icon-btn" type="button" data-act="fullscreen" title="${ui.panelFull ? '退出全屏' : '全屏编辑'}" aria-label="${ui.panelFull ? '退出全屏' : '全屏编辑'}" aria-pressed="${ui.panelFull}">${ui.panelFull ? '⤡' : '⛶'}</button>
        <button class="panel-icon-btn" type="button" data-act="collapse" title="收起侧栏" aria-label="收起侧栏">⇥</button>
        <button class="panel-close" type="button" data-act="close" aria-label="关闭">×</button>
      </span>
    </div>
    <h2 class="panel-title">${esc(n.name)}</h2>
    <div class="panel-meta" id="panelMeta">${panelMetaText(n)}</div>
    ${n.desc ? `<div class="panel-desc">${richText(n.desc)}</div>` : ''}
    <div class="mastery-progress"><span>全课掌握</span><b>${masteryPercent}%</b></div>
    <div class="panel-tabs" role="tablist" aria-label="知识点详情">
      <button class="panel-tab${ui.panelTab === 'note' ? ' active' : ''}" type="button" role="tab" aria-selected="${ui.panelTab === 'note'}" data-act="tab" data-tab="note">笔记 <span id="panelNoteCount">${n.noteCount || 0}</span></button>
      <button class="panel-tab${ui.panelTab === 'rel' ? ' active' : ''}" type="button" role="tab" aria-selected="${ui.panelTab === 'rel'}" data-act="tab" data-tab="rel">关联 <span id="panelRelCount">${relCount}</span></button>
    </div>
    <div class="panel-note-wrap" id="panelNoteWrap" ${ui.panelTab === 'note' ? '' : 'hidden'}>
      ${noteAreaHtml(n)}
    </div>
    <div class="panel-rels" id="panelRels" ${ui.panelTab === 'rel' ? '' : 'hidden'}>
      <div class="section-label">关联知识点<span>${relCount}</span></div>
      <div class="rel-list">${relListHtml(n)}</div>
      <div class="section-label">跨层级关系<span>${xRels.length}</span></div>
      <div class="rel-list">${xRelHtml}</div>
    </div>
  `;
  el.panelBody.scrollTop = 0;
  el.panelFoot.innerHTML = `
    <button class="btn ghost" type="button" data-act="edit">编辑资料</button>
    <button class="btn danger" type="button" data-act="delete">删除</button>
  `;
}

/** 切换页签。 */
export function switchPanelTab(tab) {
  if (isEditing()) return;
  ui.panelTab = tab === 'rel' ? 'rel' : 'note';
  const noteWrap = document.getElementById('panelNoteWrap');
  const relWrap = document.getElementById('panelRels');
  if (noteWrap) noteWrap.hidden = ui.panelTab !== 'note';
  if (relWrap) relWrap.hidden = ui.panelTab !== 'rel';
  el.panelBody.querySelectorAll('.panel-tab').forEach((btn) => {
    const on = btn.dataset.tab === ui.panelTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

/** 笔记条数变化后，刷新标题计数与 dock。 */
function updateNoteIndicators(n) {
  n.noteCount = countNote(n.note);
  n.noteText = noteToText(n.note);
  const meta = document.getElementById('panelMeta');
  if (meta) meta.textContent = panelMetaText(n);
  const noteCount = document.getElementById('panelNoteCount');
  if (noteCount) noteCount.textContent = n.noteCount;
  updateDock();
}

/** 只重渲染笔记区，保持滚动位置。 */
function renderNoteTab(n) {
  const wrap = document.getElementById('panelNoteWrap');
  if (!wrap) return;
  const scroll = el.panelBody.scrollTop;
  wrap.innerHTML = noteAreaHtml(n);
  el.panelBody.scrollTop = scroll;
  updateNoteIndicators(n);
}

/* ---------------------- 光标 / 焦点工具 ---------------------- */

function noteTextEl(id) {
  const nodes = Array.from(el.panelBody.querySelectorAll('.note-text'));
  return nodes.find((node) => node.dataset.nid === id) || null;
}

function caretOffset(textEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return textEl.textContent.length;
  const range = sel.getRangeAt(0);
  if (!textEl.contains(range.startContainer)) return textEl.textContent.length;
  const pre = range.cloneRange();
  pre.selectNodeContents(textEl);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

function setCaret(textEl, offset) {
  textEl.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remain = Math.max(0, offset);
  let target = null;
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (remain <= node.length) {
      target = node;
      break;
    }
    remain -= node.length;
  }
  if (target) {
    range.setStart(target, remain);
    range.collapse(true);
  } else {
    range.selectNodeContents(textEl);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function focusNoteBlock(id, position) {
  const textEl = noteTextEl(id);
  if (!textEl) return;
  const len = textEl.textContent.length;
  const at =
    typeof position === 'number'
      ? Math.max(0, Math.min(len, position))
      : position === 'start'
        ? 0
        : len;
  setCaret(textEl, at);
  if (textEl.scrollIntoView) textEl.scrollIntoView({ block: 'nearest' });
}

/* ---------------------- 笔记操作 ---------------------- */

/** 追加一个根条目并聚焦。 */
export function addRootNoteBlock() {
  const n = panelNode();
  if (!n) return;
  const block = appendRootBlock(n.note);
  renderNoteTab(n);
  scheduleSave();
  focusNoteBlock(block.id, 'start');
}

function splitNoteBlock(blockId) {
  const n = panelNode();
  if (!n) return;
  const textEl = noteTextEl(blockId);
  if (!textEl) return;
  const full = textEl.textContent.replace(/\u00a0/g, ' ');
  const offset = caretOffset(textEl);
  const next = splitBlock(n.note, blockId, offset);
  if (!next) return;
  renderNoteTab(n);
  scheduleSave();
  focusNoteBlock(next.id, 'start');
}

function indentNoteBlock(blockId) {
  const n = panelNode();
  if (!n) return;
  const textEl = noteTextEl(blockId);
  const offset = textEl ? caretOffset(textEl) : 0;
  const ok = indentBlock(n.note, blockId);
  if (!ok) {
    toast('已经是同级第一条，无法再缩进');
    return;
  }
  renderNoteTab(n);
  scheduleSave();
  focusNoteBlock(blockId, offset);
}

function outdentNoteBlock(blockId) {
  const n = panelNode();
  if (!n) return;
  const textEl = noteTextEl(blockId);
  const offset = textEl ? caretOffset(textEl) : 0;
  const ok = outdentBlock(n.note, blockId);
  if (!ok) {
    toast('已经在最外层');
    return;
  }
  renderNoteTab(n);
  scheduleSave();
  focusNoteBlock(blockId, offset);
}

function deleteNoteBlock(blockId) {
  const n = panelNode();
  if (!n) return;
  const focusId = removeBlock(n.note, blockId);
  renderNoteTab(n);
  scheduleSave();
  if (focusId) focusNoteBlock(focusId, 'end');
}

function toggleNoteBlock(blockId) {
  const n = panelNode();
  if (!n) return;
  if (toggleBlock(n.note, blockId) === null) return;
  renderNoteTab(n);
  scheduleSave();
}

/* ---------------------- 笔记输入事件 ---------------------- */

function onNoteInput(e) {
  const textEl = closest(e.target, '.note-text');
  if (!textEl) return;
  const n = panelNode();
  if (!n) return;
  const entry = findNoteEntry(n.note, textEl.dataset.nid);
  if (!entry) return;
  const clean = textEl.textContent.replace(/\u00a0/g, ' ').replace(/\r?\n/g, ' ');
  entry.block.text = clean.slice(0, 2000);
  textEl.classList.toggle('is-empty', !clean);
  updateNoteIndicators(n);
  scheduleSave();
}

function onNoteKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  const textEl = closest(e.target, '.note-text');
  if (!textEl) return;
  const n = panelNode();
  if (!n) return;
  const entry = findNoteEntry(n.note, textEl.dataset.nid);
  if (!entry) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    splitNoteBlock(entry.block.id);
    return;
  }
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (e.shiftKey) outdentNoteBlock(entry.block.id);
    else indentNoteBlock(entry.block.id);
    return;
  }
  if (e.key === 'Backspace' && !textEl.textContent.trim() && caretOffset(textEl) === 0) {
    e.preventDefault();
    deleteNoteBlock(entry.block.id);
  }
}

function onNotePaste(e) {
  const textEl = closest(e.target, '.note-text');
  if (!textEl) return;
  const raw = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  if (!raw) return;
  e.preventDefault();
  const n = panelNode();
  if (!n) return;
  const entry = findNoteEntry(n.note, textEl.dataset.nid);
  if (!entry) return;

  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    if (textEl.contains(range.commonAncestorContainer)) range.deleteContents();
  }
  const full = textEl.textContent.replace(/\u00a0/g, ' ');
  const offset = caretOffset(textEl);
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trimEnd());
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return;

  if (lines.length === 1) {
    entry.block.text = (full.slice(0, offset) + lines[0] + full.slice(offset)).slice(0, 2000);
    renderNoteTab(n);
    scheduleSave();
    focusNoteBlock(entry.block.id, offset + lines[0].length);
    return;
  }

  entry.block.text = (full.slice(0, offset) + lines[0]).slice(0, 2000);
  let at = entry.index;
  let lastId = entry.block.id;
  for (let i = 1; i < lines.length; i++) {
    const lineText = i === lines.length - 1 ? lines[i] + full.slice(offset) : lines[i];
    const block = makeNoteBlock(lineText, []);
    entry.list.splice(at + 1, 0, block);
    at++;
    lastId = block.id;
  }
  renderNoteTab(n);
  scheduleSave();
  focusNoteBlock(lastId, 'end');
}

/** 绑定面板内部所有事件（笔记输入、页签、按钮）。 */
export function bindPanel() {
  el.panelBody.addEventListener('input', onNoteInput);
  el.panelBody.addEventListener('keydown', onNoteKeydown);
  el.panelBody.addEventListener('paste', onNotePaste);
  el.scrim.addEventListener('click', closePanel);

  el.panel.addEventListener('click', (e) => {
    // 折叠状态下点击整行标题也能展开，不用非得点到右侧的小三角。
    const noteText = e.target.closest('.note-text[data-nid]');
    if (noteText) {
      const node = noteText.closest('.note-node');
      if (node && node.classList.contains('collapsed')) {
        e.preventDefault();
        toggleNoteBlock(noteText.dataset.nid);
        return;
      }
    }

    const btn = closest(e.target, '[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') closePanel();
    else if (act === 'fullscreen') setPanelFull(!ui.panelFull);
    else if (act === 'collapse') setPanelCollapsed(true);
    else if (act === 'edit') enterEdit();
    else if (act === 'delete') runAction('deleteSelected');
    else if (act === 'rel') openPanel(btn.dataset.id);
    else if (act === 'tab') switchPanelTab(btn.dataset.tab);
    else if (act === 'note-toggle') toggleNoteBlock(btn.dataset.nid);
    else if (act === 'note-add' || act === 'note-start') addRootNoteBlock();
    else if (act === 'cancelEdit') cancelEdit();
    else if (act === 'saveEdit') runAction('saveEdit');
    else if (act === 'addEditRel') addEditRelation();
    else if (act === 'toggle-mastery') {
      const entity = getEntity(ui.panelNodeId);
      if (entity && entity.level === 3) {
        const next = toggleMastery(entity);
        if (next === null) return;
        sfx.mastery(next);
        toast(next ? '已标记掌握' : '已取消掌握');
        renderHeadingPanel(getEntity(entity.id) || entity);
      }
    }
    else if (act === 'add-topic') addTopicEdge();
    else if (act === 'remove-topic') removeTopicEdge(btn.dataset.a, btn.dataset.b);
    else if (act === 'open-course') openPanel(btn.dataset.id);
    else if (act === 'reveal-note') {
      openPanel(btn.dataset.id);
      revealNoteBlock(btn.dataset.block);
    }
  });
}

/** 编辑态：加一条空关联行。 */
function addEditRelation() {
  editState.relations.push({ other: '', label: '' });
  renderEditRels();
  const rows = el.panelBody.querySelectorAll('#editRels .rel-row');
  const last = rows[rows.length - 1];
  if (last) last.querySelector('select').focus();
}

/** 编辑态：渲染关联编辑器。 */
export function renderEditRels() {
  const wrap = document.getElementById('editRels');
  if (!wrap) return;
  renderRelations(wrap, editState.relations, editState.id);
  wireRelEditor(wrap, editState, renderEditRels);
}

/** 编辑态：渲染整个面板。 */
export function renderPanelEdit(n) {
  setEditing(true);
  const cat = index.getCategory(n.cat);
  el.panelBody.innerHTML = `
    <div class="panel-head">
      <span class="chip"><i style="--c:${catColor(n.cat)}"></i>编辑模式</span>
      <span class="panel-head-actions">
        <button class="panel-icon-btn" type="button" data-act="fullscreen" title="${ui.panelFull ? '退出全屏' : '全屏编辑'}" aria-label="${ui.panelFull ? '退出全屏' : '全屏编辑'}" aria-pressed="${ui.panelFull}">${ui.panelFull ? '⤡' : '⛶'}</button>
        <button class="panel-icon-btn" type="button" data-act="collapse" title="收起侧栏" aria-label="收起侧栏">⇥</button>
        <button class="panel-close" type="button" data-act="close" aria-label="关闭">×</button>
      </span>
    </div>
    <h2 class="panel-title">编辑知识点</h2>
    <div class="panel-form">
      <div class="field">
        <label for="editName">名称</label>
        <input id="editName" type="text" maxlength="40" value="${esc(n.name)}">
      </div>
      <div class="field">
        <label for="editCat">分类</label>
        <input id="editCat" type="text" list="catOptions" maxlength="16" value="${esc(cat ? cat.name : '')}">
      </div>
      <div class="field">
        <label for="editDesc">一句话简介</label>
        <textarea id="editDesc" maxlength="200" placeholder="用一句话说明它是什么，以及在知识体系中的位置">${esc(n.desc || '')}</textarea>
        <div class="field-help">详细内容在「笔记」页用大纲记录；这里只保留一句摘要。</div>
      </div>
      <div class="field">
        <label>关联知识点</label>
        <div class="rel-editor" id="editRels"></div>
        <button class="link-btn" type="button" data-act="addEditRel">＋ 添加一条关联</button>
      </div>
    </div>
  `;
  el.panelFoot.innerHTML = `
    <button class="btn ghost" type="button" data-act="cancelEdit">取消</button>
    <button class="btn primary" type="button" data-act="saveEdit">保存修改</button>
  `;
  el.panelBody.scrollTop = 0;
  renderEditRels();
  refreshCategoryDatalist();
}

/** 绑定侧栏的收起按钮、展开按钮与左缘拖拽调宽。 */
export function bindPanelChrome() {
  applyPanelWidth();

  if (el.panelReveal) {
    el.panelReveal.addEventListener('click', () => setPanelCollapsed(false));
  }

  if (el.panelGrip) {
    let resize = null;
    el.panelGrip.addEventListener('pointerdown', (e) => {
      if (!panelOpen || e.button !== 0) return;
      e.preventDefault();
      resize = {
        startX: e.clientX,
        width: el.panel.getBoundingClientRect().width,
        id: e.pointerId
      };
      document.body.classList.add('panel-resizing');
      try {
        el.panelGrip.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    });

    el.panelGrip.addEventListener('pointermove', (e) => {
      if (!resize || resize.id !== e.pointerId) return;
      // 往左拉 → clientX 变小 → 侧栏变宽。
      const next = resize.width + (resize.startX - e.clientX);
      ui.panelWidth = next;
      applyPanelWidth();
      onPanelGeometryChanged();
    });

    const endResize = (e) => {
      if (!resize || resize.id !== e.pointerId) return;
      resize = null;
      document.body.classList.remove('panel-resizing');
      try {
        el.panelGrip.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      onPanelGeometryChanged();
    };
    el.panelGrip.addEventListener('pointerup', endResize);
    el.panelGrip.addEventListener('pointercancel', endResize);
    el.panelGrip.addEventListener('dblclick', () => {
      ui.panelWidth = 430;
      applyPanelWidth();
      onPanelGeometryChanged();
    });
  }
}