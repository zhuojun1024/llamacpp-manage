# llama.cpp 模型管理器

对 llama.cpp 启动命令做图形化维护：新增/编辑/导入/导出配置，一键启动与停止实例，
实时查看日志与关键信息（监听端口、load time、n_ctx、n_gpu_layers）。

## 一键启动

双击 `start.bat`：

1. 首次运行自动 `npm install`（装依赖）
2. 首次运行自动 `npm run build`（构建前端）
3. 启动服务并自动打开浏览器 `http://localhost:8787`

> 需已安装 Node.js 18+。`NO_BROWSER=1 start.bat` 可跳过自动开浏览器。

## 桌面版（单 exe，免 Node.js）

`npm run electron:build` 生成 `release/llamacpp-manage-<版本>-portable.exe`（约 72MB），双击即可运行：

- 数据目录为 `%APPDATA%/llamacpp-manage`（`data/` 与 `logs/` 不再位于 exe 旁）
- **关闭窗口会自动终止管理器启动的全部 llama.cpp 实例（含「失联」实例）**
- 重复双击只聚焦已有窗口；端口被占用时弹窗提示
- 开发调试：`npm run electron:dev`（自动构建前端后启动）

> 打包时若 GitHub 下载 Electron 二进制过慢，先设置镜像再执行：
> `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
> `set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

## 使用流程

1. **导入现有命令**：点右上角「导入」→ 选择 `C:\Users\zhuojun\llama-server.txt`
   （`#` 注释行自动变描述，`-a` 别名自动变名称）。重复导入会自动跳过相同命令。
2. **启动/停止**：列表里点「启动」，状态实时变化；右侧日志面板按实例分 tab 实时滚动。
3. **编辑**：点铅笔图标打开结构化表单，改完即见命令预览；也可「粘贴现有命令一键解析」。
4. **导出**：点「导出」下载回 `llama-server.txt`，兼容你现有的 bat/ps1 启动器。

## 安全说明

- 管理器只记录并操作**自己启动**的子进程 PID；停止一律按 PID 精确终止，
  **绝不按进程名扫描杀进程**——避免误杀机器上其他 llama.cpp 进程。
- 启动前做端口占用检测，被占则提示改端口（你的命令默认都是 8080，
  想同时跑多个实例请在表单里改 `--port`）。
- 管理器重启后，历史启动的存活进程标记为「失联」（仍可停止），已退出的标记「已停止」。

## 数据存储

- `data/profiles.json` — 配置列表
- `data/settings.json` — 默认 exe 路径、日志保留份数
- `data/runtime.json` — 运行中实例记录（PID 恢复用）
- `logs/run-<id>-<时间>.log` — 每次启动的日志落盘

均为人类可读 JSON/文本，直接备份即可。

## 目录结构

```
start.bat            一键启动
server/
  index.js           Express + WebSocket + 静态托管
  parser.js          命令行分词 / flag↔字段映射 / 导入 / 生成（无损）
  store.js           JSON 存储
  runner.js          子进程生命周期管理
web/                 Vue3 + Element Plus 前端（构建产物 web/dist）
test/
  roundtrip.js       解析往返测试（导入→生成 token 级 diff）
  integration.js     哑进程全链路集成测试
  dummy.js           模拟 llama-server 日志的哑进程
```

## 测试

```
npm run test:roundtrip   # 解析无损性（对真实 llama-server.txt）
node test/integration.js # 全链路（哑进程，不碰真实 llama-server）
```
