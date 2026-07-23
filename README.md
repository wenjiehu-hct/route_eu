# Global Road Test Studio

面向汽车海外道路测试、法规工程摸底、路线资产和测试运营管理的桌面/Web 平台。

## 技术栈

- React 19
- Vite 6
- Zustand 5
- Leaflet
- Electron
- ESLint 10

项目已全面移除 Vue、Pinia、Naive UI 和 `.vue` 单文件组件。

## 核心能力

- 平台级运营总览：项目组合、路线资产、测试里程、风险问题、里程碑和动态
- 海外测试项目组合：阶段、优先级、计划周期、负责人、车型版本和标签
- 项目完整工作流：范围定义 → 路线准备 → 测试执行 → 问题闭环 → 报告交付
- 常规 Waypoint 路线规划是默认主入口：地点搜索、地图选点、途经点排序、路线预览与导航
- 选区覆盖路线生成作为独立专项能力：任意多边形内生成 4–5 条长距离、低重复、平滑衔接路线
- OSM 道路类型和道路长度分析
- 限速覆盖、限速变化、条件/可变限速、隧道、环岛等法规路线特征
- 欧盟 GSR ISA、Euro NCAP、英国、美国、中国、日本及 UNECE 测试模板
- 法规测试项目、场景覆盖矩阵、测试任务、执行结果和证据索引
- 测试执行中心：驾驶员、车辆、天气、路线、场景、实测里程和跨项目排期
- 现场测试会话：行前检查、执行计时、里程表、GPS 事件时间线和场景逐项结论
- 未完成法规场景可按推荐路线自动生成测试任务，任务完成后自动回填项目场景矩阵
- 问题闭环：严重度、状态、负责人、复现路线、法规场景、证据和验证状态
- 问题根因、解决方案、修复版本与验证结论记录
- 手工路线、地图选点、路线编辑和 OSRM 实时预览
- OpenStreetMap 在线地名搜索与离线城市/坐标检索
- 路线分组、搜索、筛选、批量管理、显示/隐藏和地图聚焦
- GPX、Google Maps 导航和 Markdown 测试报告导出
- 测试标记点管理
- IndexedDB 本机证据库：视频、日志、图片、CAN 数据等附件上传、下载和删除
- 数据治理中心：JSON 备份、工作区+证据目录完整归档/恢复、持久存储和完整性检查
- 法规基线冻结：适用日期、车型类别、法规版本、审核人与适用性说明
- Markdown 工程报告和执行/问题 CSV 导出
- 基于 URL 的平台页面，可直接定位项目、执行中心、路线资产和规划工作区

## 目录结构

- `src/App.jsx`：React 路由入口与按页懒加载
- `src/components/PlatformShell.jsx`：平台导航、顶栏和全局状态
- `src/pages/`：总览、项目、执行、路线、规划、法规和数据治理页面
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

React 版本会在首次启动时把原有 localStorage 数据自动迁移到浏览器内置 IndexedDB。本地工作区数据库负责项目、路线、收藏点、测试执行、问题、里程碑和场景结果的自动保存，localStorage 仅保留兼容启动缓存；证据附件继续存放在独立 IndexedDB 文件库中。数据中心支持手动/每日自动快照、快照恢复与删除、JSON 迁移备份，以及包含附件原文件的目录归档。

当前无需数据库即可单机使用。JSON 只包含结构化数据和附件索引；需要连同视频、日志等原文件迁移时，请使用“导出工作区 + 证据目录”。建议将归档目录同步到 OneDrive、SharePoint 或企业网盘。多人协作、权限审计和超大附件场景可后续接入 PostgreSQL/Supabase 与对象存储。

## 使用限制

法规模块用于工程摸底、路线准备和内部预验证，不构成型式认证或法规合规结论。OSM 和导航数据必须通过现场标志、适用法规原文及受控测试程序复核。
