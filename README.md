# 高校拟人 OC 设定管理

一个本地运行的 OC（Original Character）设定管理系统，用于管理高校拟人化角色的各项设定、关系网、世界设定和参考文档。

## 功能

- **角色管理** — 创建、编辑、删除、拖拽排序角色，支持姓名、高校、地区、取名依据、身高、性别、生日、外貌、身份时间、诞生时间、设定描述、家族等字段
- **世界设定** — 分类管理世界观条目，支持大类和小类两级分类
- **关系网** — 角色之间建立关系（好友、对手、师徒等）并附带描述
- **文档管理** — 上传/下载/删除/在线预览文档，支持 docx（含图片解析）、txt、md 格式

## 技术栈

- **后端**：Python + FastAPI + SQLite
- **前端**：纯 HTML/CSS/JS（无框架依赖）
- **所有数据均存储在本地**，不上传任何远程服务

## 快速开始

### 环境要求

- Python 3.8+

### 安装与运行

```bash
# 1. 进入项目目录
cd Settings

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
python backend.py
```

浏览器访问 `http://localhost:8000` 即可使用。

## 项目结构

```
Settings/
├── backend.py              # FastAPI 后端（API + 静态页面托管）
├── index.html              # 角色管理页面
├── worldview.html          # 世界设定页面
├── relations.html          # 关系网页面
├── documents.html          # 文档管理页面
├── requirements.txt        # Python 依赖
├── oc_characters.db        # SQLite 数据库
└── 文字设定/               # 文档上传目录
```

## 数据存储

| 数据 | 存储位置 |
|------|---------|
| 角色、世界设定、关系网 | `oc_characters.db`（SQLite） |
| 上传的文档 | `文字设定/` 文件夹 |
| docx 中提取的图片缓存 | `文字设定/.images_cache/` |

备份整个项目文件夹即可保留所有数据。

## API 概览

所有接口路径前缀为 `/api/`：

- `GET/POST /api/characters` — 角色列表 / 创建角色
- `GET/PUT/DELETE /api/characters/{id}` — 单个角色操作
- `POST /api/characters/reorder` — 角色排序
- `GET/POST /api/world-buildings` — 世界设定列表 / 创建
- `GET/PUT/DELETE /api/world-buildings/{id}` — 单个世界设定操作
- `GET/POST /api/relations` — 关系列表 / 创建
- `GET/PUT/DELETE /api/relations/{id}` — 单个关系操作
- `GET /api/files` — 文档列表
- `POST /api/files/upload` — 上传文档
- `GET /api/files/{name}/view` — 在线预览文档内容
- `DELETE /api/files/{name}` — 删除文档
