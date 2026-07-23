# Global Road Test Studio

面向汽车海外道路测试、法规工程摸底和智能路线规划的桌面/Web 应用。

## 技术栈

- React 19
- Vite 6
- Zustand 5
- Leaflet
- Electron
- ESLint 10

项目已全面移除 Vue、Pinia、Naive UI 和 `.vue` 单文件组件。

## 核心能力

- 任意多边形道路区域规划
- 生成 4–5 条长距离、低重复、平滑衔接路线
- OSM 道路类型和道路长度分析
- 限速覆盖、限速变化、条件/可变限速、隧道、环岛等法规路线特征
- 欧盟 GSR ISA、Euro NCAP、英国、美国、中国、日本及 UNECE 测试模板
- 法规测试项目、场景覆盖矩阵、执行结果和证据索引
- 手工路线、地图选点、路线编辑和 OSRM 实时预览
- 路线分组、搜索、筛选、批量管理、显示/隐藏和地图聚焦
- GPX、Google Maps 导航和 Markdown 测试报告导出
- 测试标记点管理
- 完整 JSON 备份/恢复

## 目录结构

- `src/App.jsx`：React 应用工作台
- `src/components/MapCanvas.jsx`：Leaflet 地图与路线交互
- `src/components/CoveragePlanner.jsx`：多边形道路路线生成
- `src/components/RouteLibrary.jsx`：路线资产管理
- `src/components/ManualRoute.jsx`：手工路线编辑
- `src/components/ComplianceWorkbench.jsx`：法规测试项目与场景矩阵
- `src/stores/use*Store.js`：Zustand 状态层
- `src/services/`：路线、OSM、法规分析与存储服务
- `scripts/react-smoke.cjs`：Electron/Chromium 页面冒烟测试
- `scripts/store-regression.mjs`：状态和法规算法回归测试

## 开发与验证

```bash
npm install
npm run dev
```

```bash
npm run lint
npm test
npm run build
```

桌面应用开发与构建：

```bash
npm run electron:dev
npm run electron:build
```

## 数据兼容

React 版本继续使用原有 localStorage key 和备份 JSON 格式，升级后已有路线、收藏点和法规测试项目无需手动迁移。

## 使用限制

法规模块用于工程摸底、路线准备和内部预验证，不构成型式认证或法规合规结论。OSM 和导航数据必须通过现场标志、适用法规原文及受控测试程序复核。
