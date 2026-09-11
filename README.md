# STP 3D 模型涂鸦浏览器

一个纯前端（HTML + CSS + JavaScript）项目，使用 Three.js 加载 STEP（.stp / .step）模型，并支持在模型表面实时涂鸦绘画。

## 快速开始

直接把本目录部署到 GitHub Pages（或任意静态文件服务器）即可。模型文件应保持与本目录同级的文件名：

```
dragon dance Professional Class Version 1.step
```

> 模型已在项目中随附。若更换模型，请同步修改 `index.html` 中的 `MODEL_FILENAME` 常量，或点击页面上的「导入模型」按钮手动选择。

## 技术方案

- **STEP 解析**：Three.js 没有官方 STEPLoader，本项目通过 CDN 动态加载 [occt-import-js](https://github.com/kovacsv/occt-import-js)（基于 WebAssembly 的 OpenCASCADE 导入库），将 STEP 解析为 Three.js 可直接使用的 BufferGeometry。
- **3D 交互**：使用 OrbitControls 实现旋转 / 平移 / 缩放。
- **表面涂鸦**：由于 STEP 几何通常没有 UV，本项目不依赖 UV 贴图，而是使用 **Raycaster + DecalGeometry** 方案：射线检测获取表面命中点与法线，在命中点生成贴花几何体，并配合空间哈希网格只处理笔刷附近的三角形，保证流畅度。
- **历史记录**：每次拖动画笔形成一笔（一个 Decal 序列），撤销时移除最后一笔。
- **自动保存**：每次笔画完成后同时写入 localStorage 与 IndexedDB，刷新页面后自动恢复。
- **重置**：清除全部贴花与本地缓存，模型恢复初始纯色。
- **导入 / 导出**：将涂鸦数据（颜色、笔刷大小、命中点、法线、Decal 尺寸）导出为 JSON，导入时按数据重建贴花。

## 操作说明

1. 页面加载后自动请求同名 STEP 模型。
2. 点击「绘画」切换到画笔模式，在模型表面按住并拖动即可涂鸦。
3. 可调整颜色与笔刷大小。
4. 「撤销」移除上一笔；「重置」清空并删除缓存。
5. 「保存涂鸦」导出 JSON；「打开涂鸦」导入 JSON。

## 本地运行

由于浏览器对 `file://` 下的 `fetch` 有限制，建议使用本地静态服务器：

```bash
# Python 3
python -m http.server 8080
# 然后访问 http://localhost:8080
```

## 依赖

- [Three.js](https://threejs.org/) r160（CDN）
- [occt-import-js](https://github.com/kovacsv/occt-import-js)（CDN，WebAssembly）
