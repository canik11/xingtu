// Markdown / PDF 导入向导：只选择文件和层级，实际写入由 actions.js 完成。
// 这里不创建关系线，也不直接修改数据。
import { el, esc } from '../lib/dom.js';
import { getEntity, getOutline } from '../outline.js';
import { ui } from '../state.js';
import { parseDocumentFile } from '../import-doc.js';
import { toast } from './feedback.js';

const LEVEL_NAMES = { 1: '课程', 2: '章节', 3: '知识点' };
const MAX_TITLE = 40;

const state = {
  items: [],
  defaults: { 1: '', 2: '', 3: '' },
  defaultCourseId: '',
  defaultLevel: 2,
  busy: false,
  parsing: 0,
  open: false,
  bound: false,
  handler: null,
  message: '',
  messageKind: ''
};

let closeTimer = 0;
let openFrame = 0;

function baseTitle(name) {
  return String(name || '未命名文档')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.(md|markdown|pdf)$/i, '')
    .slice(0, MAX_TITLE);
}

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function courseList() {
  return getOutline().courses || [];
}

function chapterList() {
  return (getOutline().all || []).filter((item) => item.level === 2);
}

function entityCourseId(entity) {
  if (!entity) return '';
  return entity.level === 1 ? entity.id : (entity.courseId || '');
}

function courseIdForParent(value) {
  return entityCourseId(getEntity(value));
}

function firstCourseId() {
  const first = courseList()[0];
  return first ? first.id : '';
}

function firstChapterFor(courseId) {
  const chapter = chapterList().find((item) => item.courseId === courseId);
  return chapter ? chapter.id : '';
}

function courseOptions(selected, placeholder = '（请选择一级节点）') {
  const courses = courseList();
  if (!courses.length) return '<option value="">（还没有课程）</option>';
  return [`<option value="">${esc(placeholder)}</option>`]
    .concat(courses.map((course) => (
      `<option value="${esc(course.id)}"${course.id === selected ? ' selected' : ''}>${esc(course.name)}</option>`
    )))
    .join('');
}

function chapterOptions(courseId, selected) {
  if (!courseId) return '<option value="">（先选择一级节点）</option>';
  const chapters = chapterList().filter((chapter) => chapter.courseId === courseId);
  if (!chapters.length) return '<option value="">（该课程还没有章节）</option>';
  return ['<option value="">（请选择二级节点）</option>']
    .concat(chapters.map((chapter) => (
      `<option value="${esc(chapter.id)}"${chapter.id === selected ? ' selected' : ''}>${esc(chapter.name)}</option>`
    )))
    .join('');
}

function validParent(level, value) {
  if (level === 1) return true;
  if (!value) return false;
  if (level === 2) return courseList().some((course) => course.id === value);
  return chapterList().some((chapter) => chapter.id === value);
}

function knownCourse(courseId) {
  return courseList().some((course) => course.id === courseId) ? courseId : '';
}

function knownChapter(courseId, chapterId) {
  return chapterList().some((chapter) => (
    chapter.id === chapterId && chapter.courseId === courseId
  )) ? chapterId : '';
}

function firstParent(level) {
  if (level === 2) return firstCourseId();
  if (level === 3) return firstChapterFor(firstCourseId());
  return '';
}

function normalizeParent(level, value) {
  return validParent(level, value) ? value : firstParent(level);
}

function defaultParent(level) {
  if (level === 1) return '';
  if (level === 2) {
    return knownCourse(state.defaultCourseId)
      || knownCourse(state.defaults[2])
      || firstCourseId();
  }
  const courseId = knownCourse(state.defaultCourseId)
    || courseIdForParent(state.defaults[3])
    || firstCourseId();
  return knownChapter(courseId, state.defaults[3]) || firstChapterFor(courseId);
}

function parentPickerMarkup(item, disabled) {
  const lock = disabled ? 'disabled' : '';
  if (item.level === 1) {
    return '<span class="import-parent-none">作为一级课程，无上级</span>';
  }
  if (item.level === 2) {
    return `<select data-import-course aria-label="一级节点" ${lock}>${courseOptions(item.parentId)}</select>`;
  }
  const courseId = courseIdForParent(item.parentId) || firstCourseId();
  return `
    <select data-import-course aria-label="一级节点" ${lock}>${courseOptions(courseId)}</select>
    <select data-import-chapter aria-label="二级节点" ${lock}>${chapterOptions(courseId, item.parentId)}</select>`;
}

function findItem(key) {
  return state.items.find((item) => item.key === key) || null;
}

function readyItems() {
  return state.items.filter((item) => item.status === 'ready');
}

function selectedReady() {
  return readyItems().filter((item) => item.selected);
}

function resetWizard() {
  state.items = [];
  state.message = '';
  state.messageKind = '';
  state.busy = false;
  state.parsing = 0;
  state.defaultLevel = 2;
  state.defaults = { 1: '', 2: '', 3: '' };

  const courses = courseList();
  state.defaultCourseId = courses[0] ? courses[0].id : '';
  state.defaults[2] = state.defaultCourseId;
  state.defaults[3] = firstChapterFor(state.defaultCourseId);
  if (!courses.length) state.defaultLevel = 1;

  // 从局部视图打开时，顺着当前选中的课程/章节预填，减少手动选择。
  const current = ui.selection ? getEntity(ui.selection) : null;
  if (current && current.level === 2) {
    state.defaultLevel = 3;
    state.defaults[3] = current.id;
    state.defaultCourseId = current.courseId || state.defaultCourseId;
  } else if (current && current.level === 1 && ui.level === 'local') {
    state.defaultLevel = 2;
    state.defaults[2] = current.id;
    state.defaultCourseId = current.id;
  }
}

function setMessage(text, kind = '') {
  state.message = text || '';
  state.messageKind = kind;
}

function renderParentDefaults() {
  if (!el.importDefaultLevel || !el.importDefaultCourse) return;
  const level = state.defaultLevel;
  el.importDefaultLevel.value = String(level);

  const courses = courseList();
  let courseId = state.defaultCourseId;
  if (!courses.some((course) => course.id === courseId)) {
    courseId = level === 2 && courses.some((course) => course.id === state.defaults[2])
      ? state.defaults[2]
      : firstCourseId();
  }
  state.defaultCourseId = courseId;

  el.importDefaultCourseField.hidden = level === 1;
  el.importDefaultChapterField.hidden = level !== 3;
  if (level === 1) return;

  if (level === 2) {
    const parent = courses.some((course) => course.id === state.defaults[2])
      ? state.defaults[2]
      : courseId;
    state.defaults[2] = parent;
    state.defaultCourseId = parent;
    el.importDefaultCourse.innerHTML = courseOptions(parent);
    el.importDefaultCourse.value = parent;
    el.importDefaultCourse.disabled = state.busy || !courses.length;
    return;
  }

  const ownsChapter = chapterList().some((chapter) => (
    chapter.id === state.defaults[3] && chapter.courseId === courseId
  ));
  const chapterId = ownsChapter ? state.defaults[3] : firstChapterFor(courseId);
  state.defaults[3] = chapterId;
  el.importDefaultCourse.innerHTML = courseOptions(courseId);
  el.importDefaultCourse.value = courseId;
  el.importDefaultCourse.disabled = state.busy || !courses.length;
  el.importDefaultChapter.innerHTML = chapterOptions(courseId, chapterId);
  el.importDefaultChapter.value = chapterId;
  el.importDefaultChapter.disabled = state.busy || !courseId;
}

function updateFooter() {
  if (!el.importCount) return;
  const ready = readyItems();
  const picked = selectedReady();
  const parsing = state.parsing > 0;
  el.importCount.textContent = !state.items.length
    ? '未选择文件'
    : `${picked.length}/${ready.length} 个待导入${parsing ? ' · 解析中' : ''}`;
  el.importSelectAll.checked = ready.length > 0 && picked.length === ready.length;
  el.importSelectAll.indeterminate = picked.length > 0 && picked.length < ready.length;
  el.importSelectAll.disabled = !ready.length || state.busy;
  el.importApplyDefault.disabled = !state.items.length || state.busy;
  el.importClear.disabled = state.busy;
  el.importRun.disabled = state.busy || parsing || picked.length === 0;

  if (state.busy) {
    el.importRun.textContent = '导入中…';
    el.importStatus.textContent = '正在写入知识库，请不要关闭窗口…';
    el.importStatus.className = 'import-status is-busy';
    return;
  }
  el.importRun.textContent = '导入';

  if (state.message) {
    el.importStatus.textContent = state.message;
    el.importStatus.className = `import-status${state.messageKind === 'error' ? ' is-error' : ''}`;
    return;
  }
  if (!state.items.length) {
    el.importStatus.textContent = '先添加 Markdown 或 PDF 文件；解析完成后会显示标题、条数和字数。';
    el.importStatus.className = 'import-status';
    return;
  }
  if (parsing) {
    el.importStatus.textContent = '正在解析文件，完成后可以逐条调整级别和上级。';
    el.importStatus.className = 'import-status is-busy';
    return;
  }
  const failed = state.items.filter((item) => item.status === 'error').length;
  if (failed) {
    el.importStatus.textContent = `${failed} 个文件解析失败，失败项不会导入。`;
    el.importStatus.className = 'import-status is-error';
    return;
  }
  el.importStatus.textContent = `将导入 ${picked.length} 个文件，不创建关系线；导入后可在星图中手动连接。`;
  el.importStatus.className = 'import-status';
}

function itemMeta(item) {
  if (item.status === 'parsing') {
    return item.progress > 0 ? `解析中 ${Math.round(item.progress * 100)}%` : '解析中…';
  }
  if (item.status === 'error') return item.error || '解析失败';
  const kind = item.kind === 'pdf' ? `PDF ${item.pages} 页` : 'Markdown';
  const warning = item.warning ? ` · ${item.warning}` : '';
  return `${kind} · ${item.blocks} 条 · ${item.chars} 字${warning}`;
}

function renderRow(item) {
  const disabled = item.status !== 'ready' || state.busy;
  return `
    <div class="import-row${item.status === 'error' ? ' is-error' : ''}${item.status === 'parsing' ? ' is-parsing' : ''}" data-key="${esc(item.key)}">
      <label class="import-check" title="选择导入">
        <input type="checkbox" data-import-select ${item.selected && item.status === 'ready' ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      </label>
      <div class="import-row-main">
        <input class="import-row-title-input" data-import-title maxlength="${MAX_TITLE}" value="${esc(item.title)}" ${disabled ? 'disabled' : ''} aria-label="导入标题" />
        <div class="import-meta" title="${esc(item.file ? item.file.name : '')}">${esc(itemMeta(item))}</div>
      </div>
      <select data-import-level ${disabled ? 'disabled' : ''} aria-label="导入级别">
        ${[1, 2, 3].map((level) => `<option value="${level}"${item.level === level ? ' selected' : ''}>${LEVEL_NAMES[level]}</option>`).join('')}
      </select>
      <div class="import-parent-picker">${parentPickerMarkup(item, disabled)}</div>
      <button class="import-remove" type="button" data-import-remove aria-label="移除" ${state.busy ? 'disabled' : ''}>×</button>
    </div>`;
}

function renderList() {
  if (!el.importList) return;
  if (!state.items.length) {
    el.importList.innerHTML = '<div class="import-empty">还没有文件。可以拖入多个 Markdown / PDF，或从文件夹批量选择。</div>';
    return;
  }
  el.importList.innerHTML = state.items.map(renderRow).join('');
}

function renderAll() {
  if (!state.open) return;
  renderParentDefaults();
  renderList();
  updateFooter();
}

/** 只更新当前文件的解析进度，避免整表重绘打断输入。 */
function updateProgress(item) {
  if (!state.open) return;
  const row = [...(el.importList.querySelectorAll('.import-row') || [])]
    .find((node) => node.dataset.key === item.key);
  const meta = row && row.querySelector('.import-meta');
  if (meta) meta.textContent = itemMeta(item);
}

async function parseItems(items) {
  for (const item of items) {
    if (!state.items.includes(item)) continue;
    item.status = 'parsing';
    item.progress = 0;
    state.parsing++;
    renderAll();
    try {
      const result = await parseDocumentFile(item.file, (page, total) => {
        item.progress = total > 0 ? page / total : 0;
        updateProgress(item);
      });
      if (!state.items.includes(item)) {
        state.parsing--;
        continue;
      }
      item.status = 'ready';
      item.kind = result.kind;
      item.title = result.title || item.title;
      item.blocks = result.blocks;
      item.chars = result.chars;
      item.pages = result.pages;
      item.structured = result.structured;
      item.warning = result.warning || '';
      item.content = result.content;
      item.selected = true;
      item.error = '';
    } catch (err) {
      item.status = 'error';
      item.error = (err && err.message) || '解析失败';
      item.selected = false;
    }
    item.progress = 0;
    state.parsing--;
    renderAll();
  }
}

function addFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (state.busy) {
    toast('正在导入，请稍候');
    return;
  }
  const accepted = list.filter((file) => /\.(md|markdown|pdf)$/i.test(String(file.name || '')));
  if (!accepted.length) {
    toast('只支持 Markdown（.md/.markdown）和 PDF');
    return;
  }
  if (accepted.length < list.length) {
    toast(`已忽略 ${list.length - accepted.length} 个不支持的文件`);
  }

  const existing = new Set(state.items.map((item) => item.key));
  const added = [];
  for (const file of accepted) {
    const key = fileKey(file);
    if (existing.has(key)) continue;
    existing.add(key);
    const level = state.defaultLevel;
    const item = {
      key,
      file,
      title: baseTitle(file.name),
      kind: /\.pdf$/i.test(file.name) ? 'pdf' : 'md',
      status: 'parsing',
      progress: 0,
      selected: true,
      level,
      parentId: defaultParent(level),
      content: [],
      blocks: 0,
      chars: 0,
      pages: 0,
      structured: false,
      warning: '',
      error: ''
    };
    state.items.push(item);
    added.push(item);
  }
  if (!added.length) {
    toast('这些文件已经在列表里了');
    return;
  }
  setMessage('');
  renderAll();
  void parseItems(added);
}

function clearWizard() {
  if (state.busy) return;
  state.items = [];
  state.parsing = 0;
  setMessage('');
  resetWizard();
  renderAll();
}

function closeWizard(force = false) {
  if (!state.open) return;
  if (state.busy && !force) return;
  state.open = false;
  clearTimeout(closeTimer);
  if (openFrame) cancelAnimationFrame(openFrame);
  el.importLayer.classList.remove('open');
  closeTimer = setTimeout(() => {
    if (state.open) return;
    el.importLayer.hidden = true;
    state.items = [];
    state.parsing = 0;
    state.message = '';
    state.messageKind = '';
  }, 180);
}

/**
 * 打开导入向导；可重复调用。
 */
export function openDocImport() {
  if (!el.importLayer) return;
  if (state.open) return;
  clearTimeout(closeTimer);
  resetWizard();
  state.open = true;
  el.importLayer.hidden = false;
  renderAll();
  openFrame = requestAnimationFrame(() => {
    if (state.open) el.importLayer.classList.add('open');
  });
  setTimeout(() => {
    if (state.open && el.importFilesBtn) el.importFilesBtn.focus();
  }, 120);
}

function parentOfItem(item) {
  if (item.level === 1) return '';
  if (!validParent(item.level, item.parentId)) return '';
  return item.parentId;
}

async function runImport() {
  if (state.busy || state.parsing > 0) return;
  const picked = selectedReady();
  if (!picked.length) {
    setMessage('先选择至少一个文件', 'error');
    updateFooter();
    return;
  }
  for (const item of picked) {
    const title = String(item.title || '').trim();
    if (!title) {
      setMessage(`「${item.file.name}」还没有标题`, 'error');
      updateFooter();
      return;
    }
    if (item.level > 1 && !validParent(item.level, item.parentId)) {
      setMessage(`「${title}」需要选择一个上级${LEVEL_NAMES[item.level - 1]}`, 'error');
      updateFooter();
      return;
    }
  }

  if (!state.handler) {
    setMessage('导入功能尚未准备好', 'error');
    updateFooter();
    return;
  }

  state.busy = true;
  setMessage('');
  renderAll();
  try {
    const result = await state.handler(picked.map((item) => ({
      key: item.key,
      title: String(item.title || '').trim().slice(0, MAX_TITLE),
      level: item.level,
      parentId: parentOfItem(item),
      content: item.content,
      blocks: item.blocks,
      chars: item.chars,
      pages: item.pages,
      kind: item.kind,
      structured: item.structured,
      filename: item.file ? item.file.name : ''
    })));
    if (!result || result.ok === false) {
      setMessage((result && result.error) || '导入失败', 'error');
      state.busy = false;
      renderAll();
      return;
    }
    state.busy = false;
    closeWizard(true);
    toast(result.message || `已导入 ${picked.length} 个文档`);
  } catch (err) {
    state.busy = false;
    setMessage((err && err.message) || '导入失败', 'error');
    renderAll();
  }
}

/**
 * 绑定导入向导。actions.js 在启动时传入写入回调。
 * @param {{onImport:(items:Array<object>)=>Promise<{ok?:boolean,message?:string,error?:string}>}} options
 */
export function bindDocImport(options = {}) {
  if (options.onImport) state.handler = options.onImport;
  if (state.bound || !el.importLayer) return;
  state.bound = true;

  el.importLayer.querySelectorAll('[data-import-close]').forEach((button) => {
    button.addEventListener('click', () => closeWizard());
  });
  el.importLayer.addEventListener('pointerdown', (e) => {
    if (e.target === el.importLayer) closeWizard();
  });

  el.importFilesBtn.addEventListener('click', () => el.docFileInput.click());
  el.importFolderBtn.addEventListener('click', () => el.docFolderInput.click());

  el.docFileInput.addEventListener('change', () => {
    const files = el.docFileInput.files;
    addFiles(files);
    el.docFileInput.value = '';
  });
  el.docFolderInput.addEventListener('change', () => {
    const files = el.docFolderInput.files;
    addFiles(files);
    el.docFolderInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => {
    el.importDrop.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      el.importDrop.classList.add('is-over');
    });
  });
  el.importDrop.addEventListener('dragleave', (e) => {
    if (!el.importDrop.contains(e.relatedTarget)) el.importDrop.classList.remove('is-over');
  });
  el.importDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.importDrop.classList.remove('is-over');
    addFiles(e.dataTransfer ? e.dataTransfer.files : null);
  });

  el.importDefaultLevel.addEventListener('change', () => {
    const level = Number(el.importDefaultLevel.value) || 1;
    state.defaultLevel = level;
    if (level === 2) {
      const courseId = knownCourse(state.defaultCourseId)
        || courseIdForParent(state.defaults[2])
        || firstCourseId();
      state.defaultCourseId = courseId;
      state.defaults[2] = courseId;
    } else if (level === 3) {
      const courseId = knownCourse(state.defaultCourseId)
        || courseIdForParent(state.defaults[3])
        || firstCourseId();
      state.defaultCourseId = courseId;
      state.defaults[3] = knownChapter(courseId, state.defaults[3])
        || firstChapterFor(courseId);
    }
    setMessage('');
    renderParentDefaults();
    updateFooter();
  });
  el.importDefaultCourse.addEventListener('change', () => {
    const courseId = el.importDefaultCourse.value;
    state.defaultCourseId = courseId;
    if (state.defaultLevel === 2) state.defaults[2] = courseId;
    if (state.defaultLevel === 3) state.defaults[3] = firstChapterFor(courseId);
    setMessage('');
    renderParentDefaults();
    updateFooter();
  });
  el.importDefaultChapter.addEventListener('change', () => {
    if (state.defaultLevel === 3) state.defaults[3] = el.importDefaultChapter.value;
    setMessage('');
    updateFooter();
  });
  el.importApplyDefault.addEventListener('click', () => {
    const level = state.defaultLevel;
    const parent = defaultParent(level);
    for (const item of state.items) {
      if (item.status === 'parsing') continue;
      item.level = level;
      item.parentId = parent;
    }
    setMessage('');
    renderAll();
  });
  el.importSelectAll.addEventListener('change', () => {
    const checked = el.importSelectAll.checked;
    for (const item of readyItems()) item.selected = checked;
    updateFooter();
  });
  el.importClear.addEventListener('click', clearWizard);
  el.importRun.addEventListener('click', () => void runImport());

  el.importList.addEventListener('input', (e) => {
    const title = e.target.closest('[data-import-title]');
    if (!title) return;
    const row = title.closest('.import-row');
    const item = row && findItem(row.dataset.key);
    if (item) {
      item.title = title.value;
      setMessage('');
    }
  });
  el.importList.addEventListener('change', (e) => {
    const row = e.target.closest('.import-row');
    const item = row && findItem(row.dataset.key);
    if (!item) return;
    if (e.target.matches('[data-import-select]')) {
      item.selected = e.target.checked;
      setMessage('');
      updateFooter();
    } else if (e.target.matches('[data-import-level]')) {
      const courseId = courseIdForParent(item.parentId) || state.defaultCourseId || firstCourseId();
      item.level = Number(e.target.value) || 1;
      item.parentId = item.level === 2
        ? courseId
        : item.level === 3 ? firstChapterFor(courseId) : '';
      setMessage('');
      renderAll();
    } else if (e.target.matches('[data-import-course]')) {
      const courseId = e.target.value;
      item.parentId = item.level === 2 ? courseId : firstChapterFor(courseId);
      const picker = e.target.closest('.import-parent-picker');
      if (picker) picker.innerHTML = parentPickerMarkup(item, item.status !== 'ready' || state.busy);
      setMessage('');
      updateFooter();
    } else if (e.target.matches('[data-import-chapter]')) {
      item.parentId = e.target.value;
      setMessage('');
      updateFooter();
    }
  });
  el.importList.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-import-remove]');
    if (!remove || state.busy) return;
    const row = remove.closest('.import-row');
    const item = row && findItem(row.dataset.key);
    if (item) {
      state.items = state.items.filter((entry) => entry !== item);
      setMessage('');
      renderAll();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) {
      e.preventDefault();
      closeWizard();
    }
  });
}

/** 当前是否打开。 */
export function isDocImportOpen() {
  return state.open;
}