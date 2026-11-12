// 领域常量：存储键、面板宽度、数据版本。
// 存储键与历史版本保持一致，升级工程结构后用户旧数据不会丢。

/** localStorage 中知识库的键名（自 v1 起未变）。 */
export const STORE_KEY = 'starmap.knowledge.v1';

/** 右侧详情面板宽度（px），相机定位风口会用到。 */
export const PANEL_WIDTH = 430;

/** 画布字体栈，与 CSS 的 --font 保持一致。 */
export const FONT_STACK =
  '"Segoe UI Variable Text","Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif';

/** 数据结构版本（字段形状）。3：外观滑杆从绝对倍率改为相对基准。 */
export const DATA_VERSION = 3;

/**
 * 种子内容版本。大于当前值时首次打开会触发种子合并升级（例如合并高数上下、补全笔记）。
 * 以后修改 seed 内容并希望老用户也拿到，就把这个数字 +1。
 * 2：补全详细笔记；3：新增示例节点与关系。
 */
export const CONTENT_VERSION = 3;

/** 节点名、分类名、简介、笔记等字段的长度/规模上限。 */
export const LIMITS = {
  nodeName: 40,
  categoryName: 16,
  desc: 200,
  noteText: 2000,
  noteDepth: 16,
  noteBreadth: 800,
  edgeLabel: 20,
  coord: 100000
};