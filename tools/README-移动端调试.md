# 手机版调试指南（免打包 APK）

解决「改一行 H5 就要打 APK → 传手机 → 覆盖安装」的循环。四个方案可叠加使用。

**快速上手**：
- 只改页面 → 双击 `tools/手机版调试.bat`
- 要连电脑后端 / 要同步 → 双击 `tools/手机版调试-连后端.bat`（前端+后端+代理一把起）
- 要一份能反复重置的测试数据 → 见下面「测试数据」一节

---

## 方案 A · 电脑浏览器直跑 ⭐ 日常首选

**速度**：改完保存 → 刷新浏览器，**一两秒**。

你的 H5 代码对原生桥是**能力探测**的（`image-store.js` 的 `nativeImageStore()` 在
`window.Android` 缺失时返回 `null`，图片全链路退回 data URL），所以手机版页面
**可以直接在电脑浏览器里跑**，不需要任何代码改写。

### 用法

双击 `tools/手机版调试.bat`，或手动：

```bash
.venv\Scripts\python.exe tools\mobile-dev-server.py --port 8100
```

浏览器打开 `http://localhost:8100`，按 **F12** → **Ctrl+Shift+M** 切到手机设备模拟
（选 iPhone 或 Android，或手动设 430×932）。

页面上会出现两个浮层（都**不挡底部导航**）：

| 浮层 | 位置 | 显示什么 |
|---|---|---|
| **DEV 徽标** | 右上（窄条） | 原生桥状态、JS 报错（有错标红）；点击 = 重新加载 |
| **ocDev 面板** | 右下（在导航之上） | 默认收起成 `DEV` 圆钮；点开显示本地条数 + 四个按钮（灌测试数据 / 刷新条数 / 清空本地库 / 重载页面） |

> ⚠️ 底部导航（`.bottom-nav`）固定在屏幕最下方，占满整宽。这两个浮层的 `bottom`
> 都设在导航高度之上（`bottom:84px`）—— **别改回 `bottom:8px`**，那会正好压住导航按钮。
> 不想看它们：控制台里 `ocDev.hide()`，或启动时加 `--no-probe`。


### 与真机的差异（**判断「是不是 bug」时先看这里**）

| 能力 | 电脑浏览器 | 真机 |
|---|---|---|
| 页面渲染、布局、交互 | ✅ 完全一致 | ✅ |
| IndexedDB 读写 | ✅ 完全一致 | ✅ |
| 拖拽排序、弹窗、路由 | ✅ 完全一致 | ✅ |
| 图片显示 | ✅ 有回退表，能看（见下） | `files/images/<sha256>` |
| 图片**存入** | ⚠️ 走 data URL | `files/images/<sha256>` |
| 自动备份 | ⚠️ 不可用 | ✅ 流式备份 |
| 手动导入备份 | ⚠️ 只在库为空时自动恢复 | ✅ 同上 |

**「图片存进去之后不显示」「备份按钮没反应」在方案 A 下是预期行为。**
但**纯浏览**时图片是可以正常显示的（下面那节）。

### 图片为什么能显示

真机上图片经「搬迁」从 data URL 变成 `img://<sha256>` 引用，由原生仓库供内容；
电脑浏览器里没有原生桥，`img://` 就成了死引用，原本会显示「图片不可用，请重新同步」。

`mobile-dev-tools.js` 在灌数据时会顺手建一张 **`img://<sha256>` → 服务器图片路径** 的
对照表（`window.__ocDevImgMap`），`image-store.js` 的 `imageRefToSrcSafe()` 在原生桥缺失时
查这张表兜底。两边都用 **sha256** 当 key，所以和真机搬迁后的引用天然对得上。

生产环境不加载这个文件，`__ocDevImgMap` 不存在，**行为与改动前完全一致**。

---

## 测试数据（可反复重置）⭐ 新增

手机版的「恢复」只在**本地库为空**时触发，且只认 App 私有目录的 `data_backup.json`，
没法手动导入。所以给电脑调试准备了一份**可直接灌的测试数据**。

### 1. 从服务器导出

```bash
.venv\Scripts\python.exe tools\export-mock-backup.py
# → .workbuddy/mock/mock-backup.json  （82 角色 / 49 设定 / 55 关系，约 223 KB）
```

图片写成**服务器相对路径**（`/api/images/<sha256>.png`），所以体积小、换端口不失效。

**每次改完数据库内容，重跑一次这个脚本**，测试数据就跟上了。

### 2. 在页面里灌

**打开页面就自动灌好了** —— 本地库为空时，`mobile-dev-tools.js` 会自动 `load()` 一份，
所以不用敲任何命令。已经有数据时不会覆盖你正在测的状态。

想手动换一批，F12 打开控制台：

```js
await ocDev.load()        // 重新灌入导出包（82 角色 / 49 设定 / 55 关系）
await ocDev.seed()        // 或：灌 20 条最小样本，跑得快
await ocDev.stats()       // 看本地/服务器两边条数对比
await ocDev.reset()       // 清空本地库（会二次确认）
ocDev.copyBackup()        // 把当前库导出成备份 JSON 并复制到剪贴板
```

右下角 `DEV` 圆钮里也有对应按钮，不用记命令。灌完自动刷新当前视图。

> ⚠️ **冷启动停在「首页」，卡片列表是空的**——各视图进入时才拉数据。点一下底部
> 「角色」才会看到 82 张卡片。这不是没有数据。
>
> **改坏了直接 `reset()` + `load()` 重来**，不需要清浏览器数据。


> `load()` 用的是相对地址 `/dev-mock-backup.json`，由调试服务器提供 —— 换台机器、
> 换个端口都不用改地址。

---

## 方案 A+ · 让页面连上电脑后端 ⭐ 新增

需要**测同步功能**（从电脑下载 / 上传到电脑）时用这个。

### 一键模式

双击 `tools/手机版调试-连后端.bat`。它会：

1. 另开一个最小化窗口起后端（`server/backend.py`，:8000）
2. 等后端端口就绪
3. 起调试服务器，**并开启 API 代理**（:8100）
4. 自动开浏览器

然后在页面的 **☁ 数据同步** 弹窗里，服务器地址填：

```
http://localhost:8100
```

**填调试服务器自己的地址，不是 8000。**

因为调试服务器会把 `/api/**`、`/images/**` 转发给后端，所以对页面而言是**同源**：
不用管 CORS、不用多记一个端口、图片也能直接显示。

### 手动模式

```bash
# 窗口 1
.venv\Scripts\python.exe server\backend.py --port 8000

# 窗口 2
.venv\Scripts\python.exe tools\mobile-dev-server.py --port 8100 --proxy --backend http://localhost:8000
```

不带 `--proxy` 也能用（图片回退会直连 8000），但同步弹窗里就得填 `http://localhost:8000`，
且要依赖后端的 CORS 放行。

### ⚠️ 用代理测同步前先备份

`POST /api/sync/replace-all` 是**整库 DELETE + INSERT**，会无条件覆盖电脑端数据。
「上传到电脑」走的是增量 diff（PUT/POST/DELETE 逐条），比它安全，但**仍会真的写库**。

```bash
# 测同步前先存一份
.venv\Scripts\python.exe -c "import sqlite3,datetime;d=datetime.datetime.now().strftime('%Y%m%d_%H%M%S');s=sqlite3.connect('server/oc_characters.db');t=sqlite3.connect('.workbuddy/backup/pre-sync_'+d+'.db');s.backup(t);t.close();s.close();print('已备份')"
```

---

## 方案 B · 推送到真机 ⭐ 需要验原生时

**速度**：几秒（adb push + 重启 App）。

改 H5 资源推到手机，**不用重新打包**。

### 一次性准备（只需做一次）

1. **打一次包**（已含「开发模式」支持，本次已加入 `resolveStartUrl()`）：
   ```bash
   cd android-app && gradlew.bat assembleRelease
   ```
2. **确认 APK 可调试**（否则无法写入应用私有目录）：
   ```bash
   android-sdk/platform-tools/adb.exe shell run-as com.occharacters echo ok
   ```
   若报 `permission denied`，在 `android-app/app/build.gradle` 的 `release` 块里加：
   ```groovy
   debuggable true
   ```
   重新打包。**正式发布时记得移除这一行。**
3. **覆盖安装**（⚠️ **不要卸载**，卸载会清空 IndexedDB 全部数据）：
   ```bash
   android-sdk/platform-tools/adb.exe install -r android-app/app/build/outputs/apk/release/app-release.apk
   ```

### 之后每次改 H5

```bash
python tools\push-mobile.py --push --restart
```

它会：推送 `assets/web/` → 设备的 `files/web-dev/`，并写一个 `.enabled` 开关 → 重启 App。
**重启后 App 就从这份副本加载了。**

### 其他命令

```bash
python tools\push-mobile.py --status     # 查看开发模式状态与副本文件数
python tools\push-mobile.py --disable    # 关闭，回到 APK 内置资源
python tools\push-mobile.py --list       # 只列出连接的设备
```

### 原理

`MainActivity.resolveStartUrl()`：

```java
File devDir = new File(getFilesDir(), "web-dev");
File flag = new File(devDir, ".enabled");
File devIndex = new File(devDir, "index.html");
if (devDir.isDirectory() && flag.isFile() && devIndex.isFile()) {
    return "file://" + devIndex.getAbsolutePath();   // 开发模式：用私有目录副本
}
return "file:///android_asset/web/index.html";       // 正常：用 APK 内置资源
```

**开关的存在本身就保证了两件事**：没有副本时行为与改动前完全一致；误删副本自动回退。

### 适用

验证图片存入、备份、`img://` 解析、返回手势等**依赖原生桥**的行为。

---

## 方案 C · Chrome 远程调试真机

**用途**：方案 B 下页面出错、需要断点单步查变量时。

```bash
# 1. 端口转发（把设备的 WebView 调试端口映射到电脑）
android-sdk/platform-tools/adb.exe forward tcp:9222 localabstract:webview_devtools_remote_<PID>

# 2. 电脑 Chrome 打开
#    chrome://inspect
#    应该能看到设备上的 WebView，点 inspect
```

能拿到**完整的 DevTools**：Console、Elements、Sources 断点、Network、Application（看 IndexedDB）。
这是离真机最近的一档，代价是仍需先装一次 APK。

---

## 选择建议

| 你要改什么 | 用哪个 |
|---|---|
| CSS、布局、Pad 断点 | **A** |
| 页面逻辑、弹窗、拖拽、路由 | **A** |
| IndexedDB 数据结构 | **A**（真机再验一次） |
| 同步功能、看数据从哪来 | **A+** |
| 图片存入 / 备份 / 原生桥 | **B** |
| 疑难 bug、要看运行时变量 | **C** |
| Java / MainActivity | 只能重新打包 |

**日常 90% 的改动走 A，要连后端走 A+，涉及原生的走 B，A/B 都查不出来再上 C。**

---

## 附：`tools/` 文件清单

### 入口（双击即用）

| 文件 | 作用 |
|---|---|
| `手机版调试.bat` | 启动方案 A（静态服务器 :8100） |
| `手机版调试-连后端.bat` | 启动方案 A+（前端 + 后端 + 代理一把起） |

### 服务与数据

| 文件 | 作用 |
|---|---|
| `mobile-dev-server.py` | 方案 A/A+ 的静态服务器（DEV 探针、ocDev 工具、测试数据、API 代理、禁缓存）<br>参数：`--port` `--lan` `--proxy` `--backend` `--no-probe` |
| `mobile-dev-tools.js` | 页面内的 `ocDev` 数据工具 + 图片回退表 + 右下角可收起调试面板（自动灌数据） |
| `export-mock-backup.py` | 从数据库导出「手机版备份格式」的测试数据 → `.workbuddy/mock/mock-backup.json` |
| `push-mobile.py` | 方案 B 的推送工具（`--push --restart` / `--status` / `--disable` / `--list`） |

### 验证脚本（都是开发工具自身用的，不影响产品代码）

| 文件 | 作用 | 前置 |
|---|---|---|
| `verify-mock-data.js` | ocDev 端到端：自动灌数据 → 渲染 → seed/reset → 浮层不挡底部导航 | 调试服务器 :8100 |
| `verify-stat-chars.py` | 统计口径 **Python 侧**：直调 `backend.get_stats()`，写出 `py_stats.json` | 无（不需要起服务） |
| `verify-stat-chars.js` | 统计口径 **JS 侧**：`node:vm` 跑 `api-shim.js`，与上者逐项比对 | 先跑 `.py`；需 mock 数据 |
| `verify-stat-render.js` | 统计页渲染：桌面版 + 手机版都断言新文案出现、旧文案为零、无报错 | 调试服务器 :8100 + 后端 :8000 |
| `verify-trash.py` | 回收站 / 撤销 **后端逻辑**：编辑→撤销、删除→还原、关系自动挂回、图片 GC、清空 | 无（自带数据库副本，不碰真实库） |
| `verify-trash-ui.js` | 回收站**页面**：删除→列表出现→点还原→彻底删除，含控制台报错检查 | 后端 :8000 |

> ⚠️ 统计口径改动后**必须跑 `verify-stat-chars.py` + `.js` 这一对**（两路一致才算过）。
> 详见 `.workbuddy/memory/MEMORY.md` 的「改口径后必做」。
>
> ⚠️ `verify-trash.py` 全程只操作 `tools/_trash_test/` 下的**数据库副本**和临时图片目录，
> **不会动 `server/oc_characters.db`**；跑完全过会自己把副本删掉（有失败项则保留供复查）。
> `verify-trash-ui.js` 用的是**临时角色**（`__回收站UI测试__`），跑完彻底清掉，收尾会断言角色总数不变。

### 辅助

| 文件 | 作用 |
|---|---|
| `waitport.py` | 端口探测小工具（给 bat 用）：`python tools/waitport.py 8000` → 通=exit 0 |

### 改到产品代码的两个文件

| 文件 | 作用 |
|---|---|
| `MainActivity.java` | 新增 `resolveStartUrl()`，支持开发模式加载 |
| `image-store.js` | `imageRefToSrcSafe()` 加开发期回退分支（生产行为不变） |

⚠️ 方案 B 需要**重新打一次包**才能用（因为改了 Java）。在打这次包之前，
方案 A / A+ 立即可用，不受影响。

### 命名约定

- **不带下划线** = 长期保留（上面所有文件都是）
- **`_` 开头** = 一次性排查脚本，查完即删。当前 `tools/` 下没有 `_` 开头的文件。

> 注意：`.workbuddy/tmp_scan/` 是这些脚本的临时输出目录，不在 `tools/` 里。
