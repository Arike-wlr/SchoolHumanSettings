# 高校拟人 OC 设定管理

一个本地运行的 OC（Original Character）设定管理系统，用于管理高校拟人化角色的各项设定、关系网、世界设定和参考文档。

## 功能

- **角色管理** — 创建、编辑、删除、拖拽排序角色，支持姓名、高校、地区、取名依据、身高、性别、生日、外貌、身份时间、诞生时间、设定描述、家族等字段
- **图片与人脸** — 每个角色可上传多张图片，支持在图上圈选人脸作为头像（`face_crop`），关系网节点显示所选头像
- **世界设定** — 分类管理世界观条目，支持大类和小类两级分类
- **关系网** — 角色之间建立关系（朋友、对手、师生、亲属、冤家等）并附带描述；画布采用力导向物理布局，节点可拖动钉住、双击解锁
- **文档管理** — 上传/下载/删除/在线预览文档，支持 docx（含图片解析）、txt、md 格式
- **总览统计** — 角色与世界观规模概览、地区/性别/状态分布、家族规模、**设定完整度体检**（15 个字段的填写率与待补充清单）、**角色之最**（设定最厚 / 关系最多 / 类型最丰富 / 图片最多 / 家族羁绊最多）、**最长的世界观条目 Top 10**、**地区凝聚力与设定厚度**、关系网络质量指标、地区关系矩阵、世界观字数体量、图片与文档占用，一页看完整个设定簿
- **全局搜索** — 跨角色、世界设定、关系、文档统一检索
- **一键导出** — 侧栏「导出全部」把角色 / 世界观 / 关系汇总为一个 JSON；点击后先弹确认框（确定 / 取消），确认后才下载
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
├── desktop-offline/            # 网页版前端页面（由后端托管）
│   ├── index.html              #   角色管理
│   ├── worldview.html          #   世界设定
│   ├── relations.html          #   关系网（力导向画布）
│   ├── documents.html          #   文档管理
│   ├── stats.html              #   总览统计
│   ├── face-crop.js            #   人脸圈选
│   ├── search.js               #   全局搜索
│   ├── export-all.js           #   一键导出（含确认弹窗）
│   ├── copy-detail.js          #   详情复制
│   └── （页面源码，由 server/backend.py 托管）
├── android-app/                # Android 离线版（WebView + SPA，IndexedDB 本地存储）
│   └── app/src/main/
│       ├── assets/web/         #   SPA 前端（index.html + app.js/app.css + db.js/api-shim.js）
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

| 问题                                        | 解决方法                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Unsupported class file major version 68` | JDK 版本过高，使用 JDK 21                                                                                                                                                      |
| `SDK location not found`                  | 检查`android-app/local.properties` 的 `sdk.dir` 路径                                                                                                                       |
| 下载 Gradle 失败                            | 多试几次，或手动下载[gradle-8.11.1-bin.zip](https://services.gradle.org/distributions/gradle-8.11.1-bin.zip) 解压到 `%USERPROFILE%\.gradle\wrappers\dists\gradle-8.11.1-bin\` |

## 两种运行方式

| 方式                        | 入口                                               | 数据存哪                              | 需要后端 |
| --------------------------- | -------------------------------------------------- | ------------------------------------- | -------- |
| **网页版（电脑）**    | `server/backend.py` → `http://localhost:8000` | SQLite（`server/oc_characters.db`） | 是       |
| **手机版（Android）** | `apks/app-release.apk`                           | 应用内 IndexedDB                      | 否       |

> 网页版的页面源码在 `desktop-offline/`，由 `server/backend.py` 托管，数据存 SQLite。
> 手机版是**独立的一套 SPA**（`android-app/app/src/main/assets/web/`），数据存应用内 IndexedDB，
> 完全离线运行、不依赖后端。

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

### 同步速度

同步是增量的：只有变动的角色 / 设定 / 关系 / 文档才会传输，图片靠内容哈希去重，传过就不再传。

服务器上现有约 **136 MB 图片**和 **320 MB 文档**（含两个 87 MB / 75 MB 的 docx），所以：

- 首次同步、或服务器上那份图被清理过时，仍然要按实际流量走，快不了；
- 日常「上传到电脑」**不应该**再传输图片 —— 上传前只需确认"服务器上那张图还在不在"。
  这个核验走 `POST /api/images/exists` 批量完成（旧版后端自动降级为 `HEAD`，再降级为
  "GET 后立刻断开"，都不会下载整张图）。
- 同步完成后的状态栏会附一段耗时分解：`｜耗时 12.3s（拉取数据 0.4s / 算差异+核验图片 0.2s /
  图片 3.1s / 写数据 2.0s / 文档 6.5s）`。**嫌慢先看这段数字**，哪一段大就是哪一段的问题。
- ⚠️ **改了 `server/backend.py` 后必须重启后端**，否则跑着的还是旧进程，会退回降级路径。

### 常见问题

| 现象                                                                              | 原因                                                         | 解决                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| 手机浏览器打不开`http://电脑IP:8000`，但电脑本地 `http://127.0.0.1:8000` 正常 | Windows 防火墙将热点/WiFi 识别为"公用网络"，默认拦截入站连接 | 放行 8000 端口（见下方）        |
| 之前能连，换网络后连不上                                                          | 电脑 IP 变了（换 WiFi / 换热点网段都会变）                   | 重新查 IP，更新同步设置里的地址 |
| 手机端填`localhost` / `127.0.0.1`                                             | 手机上这些地址指向手机自己                                   | 填电脑的局域网 IP               |
| 手机热点仍连不上                                                                  | 手机热点开启了"AP 隔离 / 禁止设备互访"                       | 在手机热点设置中关闭            |

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

| 数据                   | 存储位置                              |
| ---------------------- | ------------------------------------- |
| 角色、世界设定、关系网 | `server/oc_characters.db`（SQLite） |
| 角色图片               | `server/images/`                    |
| 上传的文档             | `server/文字设定/` 文件夹           |
| docx 中提取的图片缓存  | `server/文字设定/.images_cache/`    |

备份整个项目文件夹即可保留所有数据。

关于人脸头像：每个角色的图片列表中，某一张图可以用 `face_crop` 字段记录圈选的人脸框；关系网节点优先显示该图，没有则回退到第一张图。该字段会随同步一并传输。

## 总览统计的口径

统计页（`/stats`）的数据全部来自 `GET /api/stats`。**同一套口径在两处各实现了一份，改动时必须同步修改，否则网页版与手机版数字会对不上：**

| 运行形态          | 实现位置                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| 网页版（后端）    | `server/backend.py` → `get_stats()`                                                                      |
| 手机版（Android） | `android-app/app/src/main/assets/web/api-shim.js` → `computeStats()`，由 `app.js` 的 `VM.stats` 渲染 |

> ⚠️ 手机版的 `computeStats()` 是从后端 `get_stats()` **逐字对齐**的实现，改任何一处都要同改另一处。

口径约定：

- **空字段**（空串或纯空白）统一归入「未填写」，不计入有效分类
- **性别**归入 男 / 女 / 其他 / 未填写 四桶（`男性`/`M`/`male` 等写法会归一到「男」）
- **存在状态**除空值归「存在」外，其余按原值分桶（`已消逝`、`普通人` 等自定义值各占一桶）
- **家族**从 `family` 字段按 `; ； , ， 、 / |` 或换行拆分，一个角色可属多个家族
- **关系度**＝该角色出现在 from 或 to 的次数（自环只计 1 次）；**去重对数**按无向配对统计
- **字数**按 Unicode 码点计数（`Array.from(str).length`）。若直接用 JS 的 `str.length`，emoji 会被算成 2 个，导致与 Python 的 `len()` 不一致
- **舍入**一律「远离零」（JS `Math.round` 语义）。Python 内置 `round()` 是银行家舍入（四舍六入五成双），恰落在 `.x5` 时会差 1 个末位，因此两端都显式实现了 `_round1` / `statsRound1`（1 位小数）与 `_round0` / `statsRound0`（取整）
- **不解析 `birth_time` / `birthday`**——它们是自由文本，无法结构化，因此统计页不含时间线

统计页的区块与口径：

| 区块           | 内容                                                                                                                         | 口径要点                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 概览卡         | 角色数 / 世界观条目 / 关系数 / 文档与图片                                                                                    | —                                                                                                                                                                            |
| 角色分布       | 地区、性别、状态分布 + 家族规模卡                                                                                            | 家族规模卡列出每个家族的成员数（非条形图）                                                                                                                                    |
| 设定完整度体检 | 15 个字段的分字段填写率 + 整体均值 + 待补充清单                                                                              | 字段清单见`STATS_COMPLETENESS_FIELDS`；待补充清单只列缺失 ≥3 人的字段，每人最多 10 个名字                                                                                  |
| 角色之最       | 设定最厚 / 关系最多 / 关系类型最丰富 / 图片最多 / 家族羁绊最多（各 Top 10）+ 设定篇幅分布 +**最长的世界观条目 Top 10** | 角色榜`STATS_RANK_N=10`；世界观条目榜 `STATS_WORLD_RANK_N=10`（字段 `highlights.world_longest_list`，按内容字数降序，同字数比标题）                                     |
| 关系网络       | 关系明细（手写关系、去重对数、同家族关系、孤立、双向互惠、重复、未标类型、自环、人均）+ 关系度排行 + 孤立角色                | **同家族自动关系**见下节；`total` 只数手写关系，`unique_pairs` 含家族                                                                                               |
| 地区圈子       | 地区凝聚力 + 设定厚度 + 地区关系矩阵                                                                                         | 凝聚力＝同地区内部关系 ÷ 该地区涉及的全部关系（**已含同家族自动关系**）；仅统计关系 ≥ `STATS_MIN_REGION`(3) 的地区。**设定厚度**＝该地区人均 `setting` 字数 |
| 世界观与内容   | 大类分布 + 内容体量                                                                                                          | 只统计大类；**已移除小类分布**（世界观页面已有）                                                                                                                        |
| 素材与文档     | 图片数、无图角色、取脸数、文档数与占用                                                                                       | 离线/Android 端无磁盘概念，`size_display` 为空                                                                                                                              |

> **已删除的冗余面板**：关系类型分布、世界观小类分布——这两项在关系网 / 世界观页面上已有，不再在统计页重复。

### 同家族自动关系（只影响统计计数）

只要两个角色**同属一个家族**（`family` 字段拆分后存在交集），统计时就算它们之间存在一条关系——即家族内部两两成对（完全图）。

- **仅并入统计计数**：`unique_pairs`（去重对数）、`degree`（关系度）、`connected_characters`（连通角色数）、`cross_region`（地区关系矩阵）以及**地区凝聚力**、**人均关系数**，都按「手写关系 ∪ 同家族关系」的并集计算。
- **不影响关系网页面展示**：关系网（`relations.html`）是另一套独立实现（已被封装在闭包里），其节点、连线、布局**完全不读统计口径**，页面显示与改动前一致。本次改动只在计数层面生效。
- **不计入手写数据质量指标**：`total`（手写关系条数）、`dup_pairs`（重复关系）、`no_type`（未标类型）、`self_loop`（自环）、`mutual_pairs`（双向互惠）**只反映用户手写的数据**，同家族自动关系不掺进来——否则这些「数据质量」数字会被自动生成的边冲淡，失去意义。

相关字段（`relations` 块）：

| 字段                 | 含义                                                         |
| -------------------- | ------------------------------------------------------------ |
| `total`            | 手写关系条数（用户实际录入的 from→to 行数）                 |
| `explicit_total`   | 同上，为语义清晰而保留的别名                                 |
| `explicit_pairs`   | 手写关系的去重无向对数                                       |
| `family_pairs`     | 同家族两两配对总数（含与手写关系重叠的部分）                 |
| `family_new_pairs` | 同家族配对中**不与任何手写关系重叠**、从而净新增的对数 |
| `unique_pairs`     | 合并去重后的总对数＝手写 ∪ 同家族（统计页展示的就是它）     |

统计页「关系网络」区块的文案为「手写 N 条 + 同家族自动 M 条 · 去重 X 对 · 涉及 Y 位角色 · 人均 Z 条」，其中 N=`total`、M=`family_new_pairs`、X=`unique_pairs`。

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
- `HEAD /api/images/{filename}` — 仅返回图片是否存在与大小（同步核验用，不传正文）
- `POST /api/images/exists` — 批量核验图片是否仍存在（请求体 `{"urls":[...]}`，返回 `existing` / `missing`）
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
- `GET /api/stats` — 总览统计数据（结构见上文「总览统计的口径」）
- `POST /api/sync/replace-all` — 同步：整库替换（供手机端上传）

**页面与静态资源路由**

- `/`、`/worldview`、`/relations`、`/documents`、`/stats` — 在线版页面
- `/m`、`/m/worldview`、`/m/relations`、`/m/documents` — 手机版页面
- `/search.js`、`/export-all.js`、`/copy-detail.js`、`/face-crop.js` — 前端脚本
