// 掌握度与配色：三级知识点打勾，一/二级按下属知识点完成比例渐变。
// 颜色可以全局设置，也可以按一级课程覆盖；配置随知识数据一起保存/导出。
import { BASE_SCALE } from '@starmap/core';
import { data, scheduleSave } from './store.js';
import { getEntity, chaptersOf, pointsOf } from './outline.js';

export const DEFAULT_APPEARANCE = Object.freeze({
  defaultColor: '#ffffff',
  masteredColor: '#ffa200',
  nodeBrightness: 1,
  nodeSize: 1,
  nodeStarSize: 1,
  edgeBrightness: 1,
  pulseBrightness: 1,
  pulseSize: 1,
  courses: {}
});

const DEFAULT_DEFAULT = [255, 255, 255];
const DEFAULT_MASTERED = [255, 162, 0];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SCALE_MIN = 0.4;
const SCALE_MAX = 1.8;
const SCALE_KINDS = new Set(['nodeBrightness', 'nodeSize', 'nodeStarSize', 'edgeBrightness', 'pulseBrightness', 'pulseSize']);

export function normalizeHexColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

export function normalizeScale(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, number));
}

export function hexToRgb(hex) {
  const clean = normalizeHexColor(hex, '#ffffff').slice(1);
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
}

export function rgbToCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

let cachedAppearanceSource = null;
let cachedAppearanceConfig = null;

/** 读取并规范化 data.appearance；不会修改原对象。 */
export function appearanceConfig() {
  const rawSource = data.appearance && typeof data.appearance === 'object' ? data.appearance : null;
  if (rawSource && rawSource === cachedAppearanceSource) return cachedAppearanceConfig;
  const source = rawSource || {};
  const config = {
    defaultColor: normalizeHexColor(source.defaultColor, DEFAULT_APPEARANCE.defaultColor),
    masteredColor: normalizeHexColor(source.masteredColor, DEFAULT_APPEARANCE.masteredColor),
    nodeBrightness: normalizeScale(source.nodeBrightness, DEFAULT_APPEARANCE.nodeBrightness),
    nodeSize: normalizeScale(source.nodeSize, DEFAULT_APPEARANCE.nodeSize),
    nodeStarSize: normalizeScale(source.nodeStarSize, DEFAULT_APPEARANCE.nodeStarSize),
    edgeBrightness: normalizeScale(source.edgeBrightness, DEFAULT_APPEARANCE.edgeBrightness),
    pulseBrightness: normalizeScale(source.pulseBrightness, DEFAULT_APPEARANCE.pulseBrightness),
    pulseSize: normalizeScale(source.pulseSize, DEFAULT_APPEARANCE.pulseSize),
    courses: {}
  };
  const rawCourses = source.courses && typeof source.courses === 'object' ? source.courses : {};
  Object.keys(rawCourses).forEach((courseId) => {
    if (!courseId) return;
    const item = rawCourses[courseId];
    if (!item || typeof item !== 'object') return;
    const override = {};
    const def = normalizeHexColor(item.defaultColor, '');
    const mastered = normalizeHexColor(item.masteredColor, '');
    if (def) override.defaultColor = def;
    if (mastered) override.masteredColor = mastered;
    if (override.defaultColor || override.masteredColor) config.courses[courseId] = override;
  });
  cachedAppearanceSource = rawSource;
  cachedAppearanceConfig = config;
  return config;
}

/** 写回 before 编辑，保证 data.appearance 存在。 */
export function ensureAppearance() {
  const current = appearanceConfig();
  data.appearance = current;
  return current;
}

let cachedScaledSource = null;
let cachedScaledConfig = null;

/**
 * 渲染用外观：存储的是相对滑杆值（100% = 1），这里乘上 BASE_SCALE。
 * 与 appearanceConfig 分开，界面上的百分比不会被放大。
 */
export function scaledAppearance() {
  const source = appearanceConfig();
  if (source === cachedScaledSource && cachedScaledConfig) return cachedScaledConfig;
  cachedScaledSource = source;
  cachedScaledConfig = {
    ...source,
    nodeBrightness: source.nodeBrightness * BASE_SCALE.nodeBrightness,
    nodeSize: source.nodeSize * BASE_SCALE.nodeSize,
    // 星芒是新增参数：100% 就是沿用旧的固定倍率，老用户观感不变。
    nodeStarSize: source.nodeStarSize,
    edgeBrightness: source.edgeBrightness * BASE_SCALE.edgeBrightness,
    pulseBrightness: source.pulseBrightness * BASE_SCALE.pulseBrightness,
    pulseSize: source.pulseSize * BASE_SCALE.pulseSize
  };
  return cachedScaledConfig;
}

/** 滑杆改动会直接改 appearanceConfig 缓存对象的字段，引用不变；
 *  这里主动丢掉 scaledAppearance 缓存，保证拖动时画布立即预览。 */
function invalidateScaledAppearance() {
  cachedScaledSource = null;
  cachedScaledConfig = null;
}

export function setGlobalAppearance(kind, value) {
  if (kind !== 'defaultColor' && kind !== 'masteredColor') return;
  const config = ensureAppearance();
  const color = normalizeHexColor(value, '');
  if (!color) return;
  config[kind] = color;
  data.appearance = config;
  invalidateScaledAppearance();
  scheduleSave();
}

export function setScaleAppearance(kind, value) {
  if (!SCALE_KINDS.has(kind)) return;
  const config = ensureAppearance();
  config[kind] = normalizeScale(value, DEFAULT_APPEARANCE[kind]);
  data.appearance = config;
  invalidateScaledAppearance();
  scheduleSave();
}

export function setCourseAppearance(courseId, kind, value) {
  if (!courseId || (kind !== 'defaultColor' && kind !== 'masteredColor')) return;
  const config = ensureAppearance();
  const color = normalizeHexColor(value, '');
  if (!color) return;
  const override = config.courses[courseId] || {};
  override[kind] = color;
  config.courses[courseId] = override;
  data.appearance = config;
  invalidateScaledAppearance();
  scheduleSave();
}

export function clearCourseAppearance(courseId) {
  const config = ensureAppearance();
  if (!config.courses[courseId]) return;
  delete config.courses[courseId];
  data.appearance = config;
  invalidateScaledAppearance();
  scheduleSave();
}

export function resetAppearance() {
  data.appearance = {
    defaultColor: DEFAULT_APPEARANCE.defaultColor,
    masteredColor: DEFAULT_APPEARANCE.masteredColor,
    nodeBrightness: DEFAULT_APPEARANCE.nodeBrightness,
    nodeSize: DEFAULT_APPEARANCE.nodeSize,
    nodeStarSize: DEFAULT_APPEARANCE.nodeStarSize,
    edgeBrightness: DEFAULT_APPEARANCE.edgeBrightness,
    pulseBrightness: DEFAULT_APPEARANCE.pulseBrightness,
    pulseSize: DEFAULT_APPEARANCE.pulseSize,
    courses: {}
  };
  invalidateScaledAppearance();
  scheduleSave();
}

export function courseIdOf(entityOrId) {
  const entity = typeof entityOrId === 'string' ? getEntity(entityOrId) : entityOrId;
  if (!entity) return '';
  return entity.level === 1 ? entity.id : entity.courseId || '';
}

/** 某个知识点/章节/课程当前使用的默认色与掌握色。 */
export function appearanceColors(entityOrId) {
  const entity = typeof entityOrId === 'string' ? getEntity(entityOrId) : entityOrId;
  const config = appearanceConfig();
  const courseId = courseIdOf(entity);
  const override = courseId ? config.courses[courseId] : null;
  const def = (override && override.defaultColor) || config.defaultColor;
  const mastered = (override && override.masteredColor) || config.masteredColor;
  return {
    defaultColor: def,
    masteredColor: mastered,
    defaultRgb: hexToRgb(def),
    masteredRgb: hexToRgb(mastered)
  };
}

/** 一个笔记块下所有叶子的列表；块本身无子块时返回自身。 */
export function leafBlockList(block) {
  if (!block) return [];
  const children = Array.isArray(block.children) ? block.children : [];
  if (!children.length) return [block];
  return children.flatMap(leafBlockList);
}

/** 仅叶子可手动标记；有子块的知识点由子级比例决定。 */
export function isLeafBlock(block) {
  return !!block && !(Array.isArray(block.children) && block.children.length);
}

/** 块级掌握比例：叶子看自己，父级按内部叶子完成比例。 */
export function blockMasteryRatio(block) {
  const leaves = leafBlockList(block);
  if (!leaves.length) return 0;
  const map = data.mastery || {};
  let done = 0;
  for (const leaf of leaves) if (map[leaf.id]) done++;
  return done / leaves.length;
}

function entityLeaves(entity) {
  // 只从顶层块向下递归，避免“父块 + 子块”被重复计入叶子比例。
  if (entity.level === 1) {
    return chaptersOf(entity.id).flatMap((chapter) => leafBlockList(chapter.block));
  }
  return entity.block ? leafBlockList(entity.block) : [];
}

export function masteryFor(entityOrId) {
  const entity = typeof entityOrId === 'string' ? getEntity(entityOrId) : entityOrId;
  if (!entity) return 0;
  const leaves = entityLeaves(entity);
  if (!leaves.length) return 0;
  const map = data.mastery || (data.mastery = {});
  let done = 0;
  for (const leaf of leaves) if (leaf.id && map[leaf.id]) done++;
  return done / leaves.length;
}

export function isMastered(entityOrId) {
  return masteryFor(entityOrId) >= 0.999;
}

/** 切换叶子掌握；非叶子返回 null（父级只读）。 */
export function toggleMastery(entityOrId) {
  const entity = typeof entityOrId === 'string' ? getEntity(entityOrId) : entityOrId;
  if (!entity || entity.level !== 3 || !entity.block || !isLeafBlock(entity.block)) return null;
  const map = data.mastery || (data.mastery = {});
  const next = !map[entity.block.id];
  if (next) map[entity.block.id] = true;
  else delete map[entity.block.id];
  scheduleSave();
  return next;
}

/** 当前节点颜色：默认色 → 掌握色按掌握比例插值。 */
export function masteryRgb(entityOrId) {
  const ratio = masteryFor(entityOrId);
  const palette = appearanceColors(entityOrId);
  return palette.defaultRgb.map((v, i) =>
    Math.round(v + (palette.masteredRgb[i] - v) * ratio)
  );
}

/** 关系线是否变金：同级要两端都掌握；上下级只看下级。 */
export function edgeIsMastered(a, b) {
  if (!a || !b) return false;
  const la = Number(a.level) || 0;
  const lb = Number(b.level) || 0;
  if (la === lb) return isMastered(a) && isMastered(b);
  return isMastered(la > lb ? a : b);
}

/** 关系线取色：上下级用下级所属课程；同级不同课程取平均。 */
function edgePaletteRgb(a, b, key) {
  const pa = appearanceColors(a)[key];
  const pb = appearanceColors(b)[key];
  if (!a || !b) return pa;
  const la = Number(a.level) || 0;
  const lb = Number(b.level) || 0;
  if (la !== lb) return la > lb ? pa : pb;
  if (courseIdOf(a) && courseIdOf(b) && courseIdOf(a) !== courseIdOf(b)) {
    return pa.map((v, i) => Math.round((v + pb[i]) / 2));
  }
  return pa;
}

/** 未掌握关系线的颜色：跟随节点默认色。 */
export function edgeDefaultRgb(a, b) {
  return edgePaletteRgb(a, b, 'defaultRgb');
}

/** 掌握关系线的颜色：跟随节点掌握色。 */
export function edgeMasteredRgb(a, b) {
  return edgePaletteRgb(a, b, 'masteredRgb');
}

/** 兼容旧调用：按 RGBA 字符串输出。 */
export function rgba(rgb, alpha) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}