// DOM 小工具：只做「取元素 / 缓存引用」这类无业务的事。
/** @type {Record<string, HTMLElement>} */
export const el = {};

/** 按 id 取元素，带错误提示。 */
export function $id(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error('缺少 DOM 节点 #' + id);
  return node;
}

/** 一次性缓存页面上的关键节点。 */
export function cacheDom() {
  el.stage = $id('stage');
  el.canvas = el.stage;
  el.topbar = document.querySelector('.topbar');
  el.nav = $id('nav');
  el.navBack = $id('navBack');
  el.navCrumbs = $id('navCrumbs');
  el.levelBtn = $id('levelBtn');
  el.spreadBtn = $id('spreadBtn');
  el.motionWrap = $id('motionWrap');
  el.motionBtn = $id('motionBtn');
  el.motionPanel = $id('motionPanel');
  el.motionSpeed = $id('motionSpeed');
  el.motionSpeedText = $id('motionSpeedText');
  el.statNodes = $id('statNodes');
  el.statEdges = $id('statEdges');
  el.btnAdd = $id('btnAdd');
  el.searchBox = $id('searchBox');
  el.searchInput = $id('searchInput');
  el.searchClear = $id('searchClear');
  el.searchCount = $id('searchCount');
  el.searchPop = $id('searchPop');
  el.searchSummary = $id('searchSummary');
  el.searchResults = $id('searchResults');
  el.btnMenu = $id('btnMenu');
  el.menu = $id('menu');
  el.menuDelete = $id('menuDelete');
  el.moreWrap = $id('moreWrap');
  el.zoomIn = $id('zoomIn');
  el.zoomOut = $id('zoomOut');
  el.zoomFit = $id('zoomFit');
  el.hints = document.querySelector('.hints');
  el.zoom = document.querySelector('.zoom');
  el.dock = $id('dock');
  el.dockName = $id('dockName');
  el.dockMeta = $id('dockMeta');
  el.dockOpen = $id('dockOpen');
  el.dockClose = $id('dockClose');
  el.scrim = $id('scrim');
  el.panel = $id('panel');
  el.panelBody = $id('panelBody');
  el.panelFoot = $id('panelFoot');
  el.panelGrip = $id('panelGrip');
  el.panelReveal = $id('panelReveal');
  el.modalLayer = $id('modalLayer');
  el.addForm = $id('addForm');
  el.addName = $id('addName');
  el.addCat = $id('addCat');
  el.addDesc = $id('addDesc');
  el.addRels = $id('addRels');
  el.addRelBtn = $id('addRelBtn');
  el.catOptions = $id('catOptions');
  el.appearanceLayer = $id('appearanceLayer');
  el.appearanceDefault = $id('appearanceDefault');
  el.appearanceMastered = $id('appearanceMastered');
  el.appearanceDefaultHex = $id('appearanceDefaultHex');
  el.appearanceMasteredHex = $id('appearanceMasteredHex');
  el.appearanceDefaultDot = $id('appearanceDefaultDot');
  el.appearanceMasteredDot = $id('appearanceMasteredDot');
  el.appearanceNodeBrightness = $id('appearanceNodeBrightness');
  el.appearanceNodeBrightnessValue = $id('appearanceNodeBrightnessValue');
  el.appearanceNodeSize = $id('appearanceNodeSize');
  el.appearanceNodeSizeValue = $id('appearanceNodeSizeValue');
  el.appearanceNodeStarSize = $id('appearanceNodeStarSize');
  el.appearanceNodeStarSizeValue = $id('appearanceNodeStarSizeValue');
  el.appearanceEdgeBrightness = $id('appearanceEdgeBrightness');
  el.appearanceEdgeBrightnessValue = $id('appearanceEdgeBrightnessValue');
  el.appearancePulseBrightness = $id('appearancePulseBrightness');
  el.appearancePulseBrightnessValue = $id('appearancePulseBrightnessValue');
  el.appearancePulseSize = $id('appearancePulseSize');
  el.appearancePulseSizeValue = $id('appearancePulseSizeValue');
  el.kbLayer = $id('kbLayer');
  el.kbPathInput = $id('kbPathInput');
  el.kbPickBtn = $id('kbPickBtn');
  el.kbPathHint = $id('kbPathHint');
  
  el.kbDone = $id('kbDone');
  el.rewardLayer = $id('rewardLayer');
  el.rewardDone = $id('rewardDone');
  el.appearanceCourses = $id('appearanceCourses');
  el.appearanceReset = $id('appearanceReset');
  el.appearanceDone = $id('appearanceDone');
  el.qualityMaxScale = $id('qualityMaxScale');
  el.qualityMaxScaleValue = $id('qualityMaxScaleValue');
  el.qualityPixelBudget = $id('qualityPixelBudget');
  el.qualityPixelBudgetValue = $id('qualityPixelBudgetValue');
  el.qualityStars = $id('qualityStars');
  el.qualityStarsValue = $id('qualityStarsValue');
  el.qualityStarSize = $id('qualityStarSize');
  el.qualityStarSizeValue = $id('qualityStarSizeValue');
  el.qualityGlow = $id('qualityGlow');
  el.qualityGlowValue = $id('qualityGlowValue');
  el.qualitySparkle = $id('qualitySparkle');
  el.qualitySparkleValue = $id('qualitySparkleValue');
  el.qualityAmbient = $id('qualityAmbient');
  el.qualityAmbientValue = $id('qualityAmbientValue');
  el.qualityResets = document.querySelectorAll('[data-quality-reset]');
  el.docLayer = $id('docLayer');
  el.docBody = $id('docBody');
  el.docClose = $id('docClose');
  el.docCollapseAll = $id('docCollapseAll');
  el.docExpandAll = $id('docExpandAll');
  el.docStatus = $id('docStatus');
  el.importLayer = $id('importLayer');
  el.importDrop = $id('importDrop');
  el.importFilesBtn = $id('importFilesBtn');
  el.importFolderBtn = $id('importFolderBtn');
  el.importDefaultLevel = $id('importDefaultLevel');
  el.importDefaultCourseField = $id('importDefaultCourseField');
  el.importDefaultChapterField = $id('importDefaultChapterField');
  el.importDefaultCourse = $id('importDefaultCourse');
  el.importDefaultChapter = $id('importDefaultChapter');
  el.importApplyDefault = $id('importApplyDefault');
  el.importCount = $id('importCount');
  el.importSelectAll = $id('importSelectAll');
  el.importList = $id('importList');
  el.importStatus = $id('importStatus');
  el.importClear = $id('importClear');
  el.importRun = $id('importRun');
  el.docFileInput = $id('docFileInput');
  el.docFolderInput = $id('docFolderInput');
  el.confirmLayer = $id('confirmLayer');
  el.confirmTitle = $id('confirmTitle');
  el.confirmText = $id('confirmText');
  el.confirmOk = $id('confirmOk');
  el.toast = $id('toast');
  el.fatal = $id('fatal');
  el.scrim.classList.remove('show');
  el.scrim.hidden = true;
  el.modalLayer.classList.remove('open');
  el.modalLayer.hidden = true;
}

/** 底部 dock 同步：显示/隐藏（hidden 属性在首屏写死，需显式切换）。 */
export function setDockVisible(visible) {
  el.dock.hidden = !visible;
  el.dock.classList.toggle('show', visible);
}

/** 转义为可安全插入 innerHTML 的文本。 */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** 判断事件目标是否是可输入元素（全局快捷键需要避让）。 */
export function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** 尊重系统「减少动态效果」设置。 */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 冒泡到最近的匹配选择器祖先。 */
export function closest(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}