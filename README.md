# 高校拟人 OC 设定管理

一个本地运行的 OC（Original Character）设定管理系统，用于管理高校拟人化角色的各项设定、关系网、世界设定和参考文档。

## 功能

- **角色管理** — 创建、编辑、删除、拖拽排序角色，支持姓名、高校、地区、取名依据、身高、性别、生日、外貌、身份时间、诞生时间、设定描述、家族等字段
- **世界设定** — 分类管理世界观条目，支持大类和小类两级分类
- **关系网** — 角色之间建立关系（朋友、对手、师生、亲属、冤家等）并附带描述
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
# 1. 进入后端目录
cd server

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
python backend.py
```

浏览器访问 `http://localhost:8000` 即可使用。

## 项目结构

```
Settings/
├── server/                 # 后端（FastAPI + SQLite）
│   ├── backend.py          #   FastAPI 后端（API + 静态页面托管）
│   ├── requirements.txt    #   Python 依赖
│   ├── oc_characters.db    #   SQLite 数据库
│   └── 文字设定/           #   文档上传目录
├── web-desktop/            # 桌面网页版（浏览器访问，需后端运行）
│   ├── index.html          #   角色管理页面
│   ├── worldview.html      #   世界设定页面
│   ├── relations.html      #   关系网页面
│   └── documents.html      #   文档管理页面
├── web-mobile/             # 移动网页版（手机浏览器访问，需后端运行）
│   ├── m-index.html        #   角色管理页面（移动端）
│   ├── m-worldview.html    #   世界设定页面（移动端）
│   ├── m-relations.html    #   关系网页面（移动端）
│   └── m-documents.html    #   文档管理页面（移动端）
├── android-app/            # 离线移动版（APK 源码，WebView 壳 + IndexedDB 离线存储）
├── mobile/                 # Expo 尝试（React Native，未完成，不上传）
├── android-sdk/            # Android SDK（本地工具链，不上传）
└── apks/                   # 构建产物（APK 文件）
```

## Android App

项目内置一个 Android WebView 壳应用，把网页打包成可安装的 APK，方便手机使用。

### 使用方式

1. 电脑端启动后端：`python backend.py`
2. 手机和电脑连接**同一 WiFi**
3. 在手机上安装 APK（见下方构建方法，或从 Release 下载）
4. 打开 App，输入电脑的局域网 IP 和端口
5. 点击"连接"，首次连接后地址会自动保存

> 查看电脑 IP：PowerShell 运行 `ipconfig`，找到 IPv4 地址

### 构建 APK

#### 环境要求

- JDK 21（JDK 24+ 不兼容 Gradle 8.11，推荐 [Eclipse Temurin 21](https://adoptium.net/)）
- Android SDK（构建时自动下载到 `android-sdk/`）

#### 构建步骤

```powershell
# 1. 设置环境变量（按实际路径调整）
$env:JAVA_HOME = "D:\Java\jdk-21"
$env:ANDROID_HOME = "d:\SchoolHumanSettings\android-sdk"

# 2. 首次构建：下载并安装 Android SDK 命令行工具
#    跳过此步如果 android-sdk\cmdline-tools\latest\bin\sdkmanager.bat 已存在
Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile sdk.zip
Expand-Archive sdk.zip -DestinationPath android-sdk\tmp
New-Item -ItemType Directory -Force -Path android-sdk\cmdline-tools\latest | Out-Null
Copy-Item android-sdk\tmp\cmdline-tools\* android-sdk\cmdline-tools\latest\ -Recurse -Force
Remove-Item android-sdk\tmp, sdk.zip -Recurse -Force

# 3. 安装 Android Platform 35 和 Build-tools
$sdk = "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat"
echo "y" | & $sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0"

# 4. 配置 SDK 路径（android-app/local.properties，按实际路径填写）
#    sdk.dir=d\:\\Settings\\android-sdk

# 5. 构建 APK（首次会自动下载 Gradle 8.11.1，约 140MB）
cd android-app
.\gradlew.bat assembleRelease

# 6. 构建产物
#    android-app\app\build\outputs\apk\release\app-release.apk
```

构建成功后，将 `app-release.apk` 复制到手机安装即可。APK 使用 debug 签名，安装时可能需要允许"未知来源"。

#### 常见问题

| 问题 | 解决方法 |
|------|---------|
| `Unsupported class file major version 68` | JDK 版本过高，使用 JDK 21 |
| `SDK location not found` | 检查 `android-app/local.properties` 的 `sdk.dir` 路径 |
| 下载 Gradle 失败 | 多试几次，或手动下载 [gradle-8.11.1-bin.zip](https://services.gradle.org/distributions/gradle-8.11.1-bin.zip) 解压到 `%USERPROFILE%\.gradle\wrappers\dists\gradle-8.11.1-bin\` |
| 手机连不上后端 | 确认手机和电脑在同一 WiFi，关闭路由器"AP 隔离"，检查 Windows 防火墙允许 8000 端口 |

## 数据存储

| 数据 | 存储位置 |
|------|----------|
| 角色、世界设定、关系网 | `server/oc_characters.db`（SQLite） |
| 上传的文档 | `server/文字设定/` 文件夹 |
| docx 中提取的图片缓存 | `server/文字设定/.images_cache/` |

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
