# 高校拟人 OC 设定管理

一个本地运行的 OC（Original Character）设定管理系统，用于管理高校拟人化角色的各项设定、关系网、世界设定和参考文档。

## 功能

- **角色管理** — 创建、编辑、删除、拖拽排序角色，支持姓名、高校、地区、取名依据、身高、性别、生日、外貌、身份时间、诞生时间、设定描述、家族等字段
- **图片与人脸** — 每个角色可上传多张图片，支持在图上圈选人脸作为头像（`face_crop`），关系网节点显示所选头像
- **世界设定** — 分类管理世界观条目，支持大类和小类两级分类
- **关系网** — 角色之间建立关系（朋友、对手、师生、亲属、冤家等）并附带描述；画布采用力导向物理布局，节点可拖动钉住、双击解锁
- **文档管理** — 上传/下载/删除/在线预览文档，支持 docx（含图片解析）、txt、md 格式
- **全局搜索** — 跨角色、世界设定、关系、文档统一检索
- **深色模式** — 支持浅色 / 深色主题切换

## 技术栈

- **后端**：Python + FastAPI + SQLite
- **前端**：纯 HTML/CSS/JS（无框架依赖）
- **所有数据均存储在本地**，不上传任何远程服务

## 快速开始

### 环境要求

- Python 3.8+

### 安装与运行

```bash
# 1. 进入后端目录
cd server

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
python backend.py
```

浏览器访问 `http://localhost:8000` 即可使用。

**推荐用项目自带的虚拟环境**（依赖已装好，且不会污染全局 Python）：

```bash
.venv\Scripts\python.exe server\backend.py --port 8000
```

`backend.py` 的路径全部基于文件自身位置解析，因此**从任何目录启动都能正确找到数据库与静态页面**。

可用参数：`--port`（默认 `8000`）。

### 一键启动（Windows 桌面快捷方式）

项目根目录的 `启动后端.bat` 封装了启动步骤，双击即可：

- 自动使用项目自带的 `.venv` 虚拟环境（缺依赖时脚本会给出创建命令）
- 启动后自动打开默认浏览器
- 若 8000 端口已在监听（后端已在运行），**不会重复启动**，直接打开浏览器
- 服务日志实时显示在该窗口，**关闭窗口即停止服务**

桌面上的快捷方式 **「高校拟人OC后端」** 指向该脚本，图标取自 App 图标（`oc-backend.ico`）。

> 快捷方式记录的是绝对路径。若移动了项目文件夹，重建一个指向 `启动后端.bat` 的快捷方式即可（在该 .bat 上右键 → 发送到 → 桌面快捷方式，再到属性里把图标改成 `oc-backend.ico`）。

## 项目结构

```
Settings/
├── server/                     # 后端（FastAPI + SQLite）
│   ├── backend.py              #   FastAPI 后端（API + 静态页面托管）
│   ├── requirements.txt        #   Python 依赖
│   ├── check_sync.ps1          #   局域网同步一键排查脚本
│   ├── oc_characters.db        #   SQLite 数据库
│   ├── images/                 #   角色图片存储
│   └── 文字设定/               #   文档上传目录
│       └── .images_cache/      #   docx 中提取的图片缓存
├── desktop-offline/            # 在线版前端页面（由后端托管）
│   ├── index.html              #   角色管理
│   ├── worldview.html          #   世界设定
│   ├── relations.html          #   关系网（力导向画布）
│   ├── documents.html          #   文档管理
│   ├── db.js / api-shim.js     #   数据层与接口适配
│   ├── face-crop.js            #   人脸圈选
│   ├── search.js               #   全局搜索
│   ├── export-all.js           #   一键导出
│   ├── copy-detail.js          #   详情复制
│   ├── sync.js / sync-ui.js    #   局域网同步
│   └── main.go / go.mod        #   可选：Go 单文件服务器（:8080）
├── android-app/                # Android 离线版（WebView + SPA，IndexedDB 本地存储）
│   └── app/src/main/
│       ├── assets/web/         #   SPA 前端（index.html + JS/CSS）
│       └── java/.../           #   MainActivity.java（WebView 壳）
├── android-sdk/                # Android SDK（本地工具链，不上传）
├── apks/                       # 构建产物（APK 文件）
│
├── 启动后端.bat                # 一键启动后端（Windows）
├── oc-backend.ico              # 桌面快捷方式图标
└── README.md
```

> `server/` 通过 `backend.py` 托管 `desktop-offline/` 下的页面，所以**在线版的前端源码在 `desktop-offline/`**。
> Android 端是独立的一套 SPA（在 `android-app/app/src/main/assets/web/`），离线运行、不依赖后端。

## Android App

Android 离线版，基于 WebView 加载 SPA（单页应用），所有数据存储在 IndexedDB 本地数据库中，**无需连接后端**即可使用。

### 特性

- 离线优先：角色、世界设定、关系网、文档全部本地存储
- 支持导入/导出 JSON 备份
- 支持 docx/txt/md 文档上传与预览

### 项目结构

- **`android-app/app/src/main/assets/web/`** — SPA 前端（HTML/JS/CSS），所有业务逻辑在此
- **`android-app/`** — Android WebView 壳工程
- 构建命令：在 `android-app/` 中运行 `./gradlew assembleRelease`
- 构建产物：`android-app/app/build/outputs/apk/release/app-release.apk`，历史产物也存放在根目录的 `apks/`

### 构建 APK

#### 环境要求

- JDK 21（JDK 24+ 不兼容 Gradle 8.11，推荐 [Eclipse Temurin 21](https://adoptium.net/)）
- Android SDK（构建时自动下载到 `android-sdk/`）

#### 构建步骤

```powershell
# 1. 设置环境变量（按实际路径调整）
$env:JAVA_HOME = "D:\Java\jdk-21"
$env:ANDROID_HOME = "d:\Settings\android-sdk"

# 2. 构建 APK
cd android-app
.\gradlew.bat assembleRelease
```

构建产物：`android-app/app/build/outputs/apk/release/app-release.apk`

APK 使用 debug 签名，安装时可能需要允许"未知来源"。

#### 常见问题

| 问题 | 解决方法 |
|------|---------|
| `Unsupported class file major version 68` | JDK 版本过高，使用 JDK 21 |
| `SDK location not found` | 检查 `android-app/local.properties` 的 `sdk.dir` 路径 |
| 下载 Gradle 失败 | 多试几次，或手动下载 [gradle-8.11.1-bin.zip](https://services.gradle.org/distributions/gradle-8.11.1-bin.zip) 解压到 `%USERPROFILE%\.gradle\wrappers\dists\gradle-8.11.1-bin\` |

## 三种运行方式

| 方式 | 入口 | 数据存哪 | 需要后端 |
|------|------|----------|----------|
| **在线版** | `server/backend.py` → `http://localhost:8000` | SQLite（`server/oc_characters.db`） | 是 |
| **离线单文件** | `desktop-offline/main.go` → `http://localhost:8080` | 浏览器 IndexedDB | 否 |
| **Android App** | `apks/app-release.apk` | 应用内 IndexedDB | 否 |

### 离线单文件版（Go）

`desktop-offline/main.go` 用 `go:embed` 把 HTML/JS **打进单个可执行文件**，启动后自动开浏览器，数据存在浏览器本地，不依赖 Python 后端：

```bash
cd desktop-offline
go run main.go          # 或 go build -o oc-desktop.exe main.go
```

访问 `http://localhost:8080`。适合把页面整个拷给别人独立使用。

## 手机 ↔ 电脑同步（局域网）

手机端 App 支持通过局域网与电脑上的后端双向同步数据（角色 / 世界设定 / 关系 / 文档 / 图片）。

### 基本步骤

1. 电脑上启动后端：`cd server && python backend.py`（监听 `0.0.0.0:8000`，局域网可达）
2. 让手机和电脑处于**同一个局域网**：
   - 手机和电脑连同一个路由器 WiFi；或
   - 手机开热点，电脑连接该热点
3. 在电脑上查询本机 IP：`ipconfig`（或 PowerShell：`Get-NetIPAddress -AddressFamily IPv4`），记下当前网络适配器的 IPv4 地址
4. 手机浏览器访问 `http://<电脑IP>:8000` 验证连通性
5. 打开 App → 同步 → 服务器地址填 `<电脑IP>:8000` → 测试 → 上传/下载

### 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| 手机浏览器打不开 `http://电脑IP:8000`，但电脑本地 `http://127.0.0.1:8000` 正常 | Windows 防火墙将热点/WiFi 识别为"公用网络"，默认拦截入站连接 | 放行 8000 端口（见下方） |
| 之前能连，换网络后连不上 | 电脑 IP 变了（换 WiFi / 换热点网段都会变） | 重新查 IP，更新同步设置里的地址 |
| 手机端填 `localhost` / `127.0.0.1` | 手机上这些地址指向手机自己 | 填电脑的局域网 IP |
| 手机热点仍连不上 | 手机热点开启了"AP 隔离 / 禁止设备互访" | 在手机热点设置中关闭 |

### 放行防火墙 8000 端口

方式一（图形界面）：
1. Windows 安全中心 → 防火墙和网络保护 → 高级设置
2. 入站规则 → 新建规则 → 端口 → TCP → 本地端口 `8000` → 允许连接 → 配置文件全选 → 命名保存

方式二（管理员 PowerShell）：
```powershell
netsh advfirewall firewall add rule name="OC Backend 8000" dir=in action=allow protocol=TCP localport=8000
```

方式三（一键排查脚本，位于 `server/check_sync.ps1`）：
```powershell
powershell -ExecutionPolicy Bypass -File server/check_sync.ps1        # 只诊断
powershell -ExecutionPolicy Bypass -File server/check_sync.ps1 -Fix   # 诊断 + 自动放行（需管理员）
```

## 数据存储

| 数据 | 存储位置 |
|------|----------|
| 角色、世界设定、关系网 | `server/oc_characters.db`（SQLite） |
| 角色图片 | `server/images/` |
| 上传的文档 | `server/文字设定/` 文件夹 |
| docx 中提取的图片缓存 | `server/文字设定/.images_cache/` |

备份整个项目文件夹即可保留所有数据。

关于人脸头像：每个角色的图片列表中，某一张图可以用 `face_crop` 字段记录圈选的人脸框；关系网节点优先显示该图，没有则回退到第一张图。该字段会随同步一并传输。

## API 概览

所有接口路径前缀为 `/api/`。

**角色**

- `GET /api/characters` — 角色列表
- `POST /api/characters` — 创建角色
- `GET /api/characters/{id}` — 单个角色
- `PUT /api/characters/{id}` — 更新角色
- `DELETE /api/characters/{id}` — 删除角色
- `POST /api/characters/reorder` — 角色排序

**图片**

- `POST /api/images/upload` — 上传图片
- `POST /api/characters/{id}/upload-image` — 为角色上传图片
- `DELETE /api/characters/{id}/images/{index}` — 删除角色某张图片
- `GET /api/images/{filename}` — 读取图片
- `DELETE /api/images/{filename}` — 删除图片
- `GET /api/files/images/{cache_key}/{img_name}` — 读取 docx 内提取的图片

**世界设定**

- `GET /api/world-buildings` — 列表
- `POST /api/world-buildings` — 创建
- `GET/PUT/DELETE /api/world-buildings/{id}` — 单个条目操作
- `POST /api/world-buildings/reorder` — 排序

**关系**

- `GET /api/relations` — 列表
- `POST /api/relations` — 创建
- `GET/PUT/DELETE /api/relations/{id}` — 单条关系操作
- `POST /api/relations/reorder` — 排序

**文档**

- `GET /api/files` — 文档列表
- `POST /api/files/upload` — 上传文档
- `GET /api/files/{name}/view` — 在线预览文档内容
- `GET /api/files/{name}` — 下载文档
- `DELETE /api/files/{name}` — 删除文档

**搜索与同步**

- `GET /api/search` — 全局搜索
- `POST /api/sync/replace-all` — 同步：整库替换（供手机端上传）

**页面与静态资源路由**

- `/`、`/worldview`、`/relations`、`/documents` — 在线版页面
- `/m`、`/m/worldview`、`/m/relations`、`/m/documents` — 手机版页面
- `/search.js`、`/export-all.js`、`/copy-detail.js`、`/face-crop.js` — 前端脚本
