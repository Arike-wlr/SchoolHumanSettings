# 高校拟人OC · 手机APP

基于 React Native (Expo) 的高校拟人OC设定管理应用，支持 iOS 和 Android。

## 功能模块

- **角色管理** — 角色列表、搜索、地区筛选、详情查看、新增/编辑/删除
- **世界观设定** — 大类切换、分类筛选、设定管理
- **关系网** — 关系图谱（简易版）和列表视图、关系增删改
- **文档管理** — 上传、在线查看（docx含图片/txt/md）、下载、删除

## 技术栈

- **框架**: React Native + Expo SDK 52
- **导航**: React Navigation 7 (Bottom Tabs + Native Stack)
- **文件**: expo-document-picker, expo-file-system
- **API**: 连接现有 FastAPI 后端

## 快速开始

### 环境要求

- Node.js 18+
- Expo Go App (手机端) 或模拟器

### 安装

```bash
cd mobile
npm install
```

### 配置后端地址

编辑 `src/api/index.js`，将 `BASE_URL` 修改为你的后端地址：

```js
// Android 模拟器默认
const BASE_URL = 'http://10.0.2.2:8000';

// iOS 模拟器
// const BASE_URL = 'http://localhost:8000';

// 真机测试 - 用电脑的局域网IP
// const BASE_URL = 'http://192.168.1.xxx:8000';
```

> 真机测试时，确保手机和电脑在同一局域网，并且后端使用 `0.0.0.0` 启动：
> ```bash
> python backend.py
> ```

### 启动

```bash
npx expo start
```

用 Expo Go 扫码或连接模拟器即可运行。

## 项目结构

```
mobile/
├── App.js                          # 主入口 + 导航配置
├── package.json
├── app.json
├── babel.config.js
└── src/
    ├── api/index.js                # API 客户端
    ├── constants/colors.js         # 主题色配置
    ├── components/
    │   ├── Button.js
    │   ├── SearchBar.js
    │   ├── FilterTabs.js
    │   └── FormModal.js
    └── screens/
        ├── CharactersScreen.js     # 角色列表
        ├── CharacterDetailScreen.js # 角色详情
        ├── CharacterFormScreen.js  # 角色表单
        ├── WorldviewScreen.js      # 世界观列表
        ├── WorldviewDetailScreen.js
        ├── WorldviewFormScreen.js
        ├── RelationsScreen.js      # 关系网
        ├── RelationFormScreen.js
        ├── DocumentsScreen.js      # 文档管理
        └── DocumentViewScreen.js   # 文档查看
```
