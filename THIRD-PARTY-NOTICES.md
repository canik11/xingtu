# 第三方组件声明

本项目自身代码按 [CC BY-NC-SA 4.0](LICENSE) 授权。下面这些第三方组件由各自作者按各自许可授权，**不受本项目许可的额外限制**。分发本项目（包括 `app/index.html` 单文件版、安装包）时，请连同本文件与 `licenses/` 目录一起保留。

## 随产物分发的运行时组件

| 组件 | 用途 | 许可 | 版权 |
|---|---|---|---|
| [pixi.js](https://pixijs.com/) | WebGL 星空渲染 | MIT | Copyright (c) 2013-2023 Mathew Groves, Chad Engler |
| [pdf.js / pdfjs-dist](https://mozilla.github.io/pdf.js/) | PDF 导入与文本抽取 | Apache-2.0 | Copyright 2024 Mozilla Foundation |

- pixi.js 的 MIT 许可全文：`licenses/PIXI-MIT.txt`（要求在所有副本中保留版权声明与许可声明）
- PDF.js 的 Apache-2.0 许可全文：`licenses/PDFJS-APACHE-2.0.txt`；构建产物中同时保留了 PDF.js 源码头部的 `@licstart … @licend` 许可声明块
- PDF.js 内部引用了 Adobe / Foxit 的 CMap 与标准字体**文件名字符串**，但本项目的构建产物不包含这些字体文件本身

## 仅用于构建、不随产物分发

| 组件 | 用途 | 许可 |
|---|---|---|
| [Vite](https://vite.dev/) | 打包与开发服务器 | MIT |
| [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) 之外的 Node 工具链 | 测试与打包脚本 | 各自 MIT / ISC |

构建期依赖不会进入 `app/index.html`，因此这里只作说明，不承担分发义务。

## 关于“本项目不能商用”

“禁止商业使用”这一限制来自本项目自身的 CC BY-NC-SA 4.0 许可，只约束本项目代码；它**不能、也不应**被理解为对上述 MIT / Apache-2.0 组件的额外限制——这些组件本身仍然可以按它们的原许可被任何人使用。