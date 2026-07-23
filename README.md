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
- 任意多边形道路区域规划
- 生成 4–5 条长距离、低重复、平滑衔接路线
- OSM 道路类型和道路长度分析
- 限速覆盖、限速变化、条件/可变限速、隧道、环岛等法规路线特征
- 欧盟 GSR ISA、Euro NCAP、英国、美国、中国、日本及 UNECE 测试模板
- 法规测试项目、场景覆盖矩阵、测试任务、执行结果和证据索引
- 测试执行中心：驾驶员、车辆、天气、路线、场景、实测里程和跨项目排期
- 问题闭环：严重度、状态、负责人、复现路线、法规场景、证据和验证状态
- 手工路线、地图选点、路线编辑和 OSRM 实时预览
- 路线分组、搜索、筛选、批量管理、显示/隐藏和地图聚焦
- GPX、Google Maps 导航和 Markdown 测试报告导出
- 测试标记点管理
- 数据治理中心：完整 JSON 备份/恢复、浏览器持久存储、完整性检查和备份记录
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

React 版本继续使用原有 localStorage key 和备份 JSON 格式。旧项目会自动补齐阶段、优先级、里程碑、测试执行、问题和活动记录等 v2 字段，已有路线、收藏点和法规测试数据无需手动迁移。

当前无需数据库即可单机使用。长期保存建议定期从“数据与备份中心”导出完整 JSON，并同步到 OneDrive、SharePoint、企业网盘或 Git LFS。多人协作、权限审计和大附件场景可后续接入 PostgreSQL/Supabase 与对象存储。

## 使用限制

法规模块用于工程摸底、路线准备和内部预验证，不构成型式认证或法规合规结论。OSM 和导航数据必须通过现场标志、适用法规原文及受控测试程序复核。
