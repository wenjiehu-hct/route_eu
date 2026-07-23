# Route Planner Pro（Vue 3 版）

## 技术栈
- Vue 3
- Vite
- Pinia
- Naive UI
- Leaflet

## 已完成的基础能力
- 地图打点
- 草稿实时预览
- OSRM 路线统计
- Google Maps 导航链接生成
- 分组化路线管理骨架
- 路线编辑 / 复制 / 删除 / 重命名
- 分组新建 / 重命名 / 删除 / 全显示 / 全隐藏
- 兼容旧 localStorage 路线数据并自动迁移到默认分组

## 目录
- `src/stores/routePlanner.js`：核心业务状态
- `src/components/MapCanvas.vue`：地图画布
- `src/components/DraftEditor.vue`：草稿编辑器
- `src/components/DraftPreviewCard.vue`：草稿统计预览
- `src/components/RouteGroupTree.vue`：分组与路线管理
- `src/services/routing.js`：路由与统计逻辑
- `src/services/storage.js`：本地存储与旧数据迁移

## 启动
先安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

构建：

```bash
npm run build
```

## 说明
由于这次环境里没有顺利执行 npm 安装与构建命令，这一版已经把项目文件全部搭好，但依赖安装和本地构建需要你在本机执行一次。
