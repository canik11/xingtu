// 应用级可变状态。集中放在这里，避免各模块互相 import 造成环。
import { PANEL_WIDTH } from '@starmap/core';

/** 相机：世界坐标 → 屏幕坐标。 */
export const cam = {
  x: 0,
  y: 0,
  scale: 1,
  tx: 0,
  ty: 0,
  tscale: 1
};

/** 视口尺寸（CSS 像素）与设备像素比。 */
export const view = {
  w: 0,
  h: 0,
  dpr: 1
};

/** 交互态：选中、悬停、手势、面板、层级。 */
export const ui = {
  selection: null,
  hover: null,
  hoverEdge: null,
  gesture: null,
  dragNode: null,
  pointer: { x: 0, y: 0, downX: 0, downY: 0, moved: false, dragging: false },
  panelMode: 'view',
  panelTab: 'note',
  panelNodeId: null,
  panelOpen: false,
  panelCollapsed: false,
  panelFull: false,
  panelWidth: 430,
  searchTerm: '',
  searchHits: [],
  suppressClick: false,

  /** 星海视图模式：'3d'（球体）或 '2d'（平面星云）。局部标题图不受影响。 */
  mode: '3d',

  /* 层级：sphere（外层 3D 球）→ local（单击后的局部 3D 关系图）→ inner（旧内部 3D）。 */
  level: 'sphere',
  focusId: null,
  hostId: null,
  innerSelection: null,
  innerGraph: null,
  /** 3D 星海显示范围：1 = 课程；2 = 课程 + 章节；3 = 前三级；4 = 全部层级（含更深子知识点）。 */
  sphereScope: 1,
  /** 3D 球体的随机膨胀：0 = 标准球，1 = 完全展开；target 用于补间。 */
  spherePuff: 0,
  spherePuffTarget: 0,
  spherePuffSeed: 1,
  spherePuffPrevSeed: 1,
  spherePuffSeedMix: 1,
  spherePuffDepth: 0.62,
  /** 局部 3D 关系图的临时图（章节 / 知识点）。 */
  focusGraph: null,

  /* 3D 视角旋转（弧度）与拖拽态。 */
  sphereRot: { x: -0.18, y: 0.35 },
  innerRot: { x: -0.12, y: 0.3 },
  focusRot: { x: -0.14, y: 0.3 },
  sphereOffsets: new Map(),
  orbitDrag: null,

  /* 3D 静默效果可以叠加：旋转 / 呼吸 / 膨胀；三项都关即静止。 */
  idleModes: { rotate: true, breathe: false, puff: false },
  idleSpeed: 1,
  idlePhase: 0,
  breathPhase: 0,
  idleBreath: 1,

  /* 从 3D 平铺到 2D 的过渡：{ from: Map<id,{x,y}>, start, dur }。 */
  transition: null
};

/** 帧时钟。 */
export const clock = { now: 0, last: 0 };

/** 运行开关。 */
export const flags = { debug: false, reducedMotion: false, onboarding: true };

/** 常量：面板宽度（供布局使用）。 */
export const PANEL_W = PANEL_WIDTH;

/** 重置交互态（关闭面板/取消选中时用）。 */
export function resetInteraction() {
  ui.dragNode = null;
  ui.gesture = null;
  ui.pointer.moved = false;
  ui.pointer.dragging = false;
  ui.suppressClick = false;
}