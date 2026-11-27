# pi harness

极简的本地 coding agent harness，基于 **Next.js + Electron + pi SDK + assistant-ui**。全程深色主题。

## 功能

- 配置 `opencode-go` 的 API Key（输入框只显示掩码）与模型 ID
- 多工作目录：侧边栏保存多个项目路径，每个目录可单独新建会话；不同项目的会话可以同时运行
- 多会话：新建、切换、删除；历史存为 JSONL，重启后继续
- 流式输出、工具调用折叠展示、中止运行、后台会话运行状态提示

## 运行

需要 Node.js 22.19+。

```bash
npm install

# 开发
npm run dev          # http://127.0.0.1:4311

# 桌面端（自动拉起 Next，没有构建产物时用 dev 模式；也可先 npm run dev 再复用）
npm run desktop

# 打包
npm run desktop:pack # 免安装目录 release/win-unpacked
npm run desktop:dist # 安装包 release/pi harness Setup <version>.exe
```

首次启动会弹出设置，填入 opencode-go API Key 和模型 ID（默认 `deepseek-v4.1-flash`）。
侧边栏「工作目录」里添加项目路径，点行尾的 `＋` 即可在该项目下新开会话。

打包脚本通过 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 使用 npmmirror，
也可以自行覆盖这两个环境变量。

## 数据目录

- 开发 / 未打包：仓库下的 `./data`
- 打包后：Electron userData 下的 `data`（Windows 为 `%APPDATA%/pi harness/data`）

可用环境变量 `HARNESS_DATA` 覆盖：

```
data/
  config.json          apiKey / model / workspaces（明文，勿提交）
  agent/auth.json      与 ~/.pi 隔离的 pi 凭据
  sessions/*.jsonl     所有会话（跨工作目录）
```

## 图标

`lib/pi-logo.svg` 是图标源文件：Next.js 直接把它用作 favicon 和侧边栏 logo；
`electron/icon.png` / `electron/icon.ico` 由它渲染而来，用于窗口 / 任务栏 / 安装包。

## 代码结构

```
app/page.tsx                    工作目录、会话列表、设置、目录选择
components/chat.tsx             assistant-ui 聊天界面（external store runtime）
app/api/config                  读写 key/model
app/api/workspaces              添加 / 移除工作目录
app/api/sessions                列出 / 新建会话（可带 cwd）
app/api/sessions/[id]           发送消息、中止、删除
app/api/sessions/[id]/events    SSE：sync / delta 事件
lib/harness.ts                  pi SDK：模型运行时、活跃会话、消息映射
electron/main.cjs               启动（或复用）Next 服务 + 窗口 + 目录选择 IPC
electron/preload.cjs            暴露 window.harness.pickDirectory
electron-builder.yml            安装包配置
```

一轮对话的流程：`POST /api/sessions/[id]` 在后台调用 `session.prompt()`，
pi 的事件流被转换成 SSE：文本增量发 `delta`，消息/工具状态变化发全量 `sync`，
客户端交给 `useExternalStoreRuntime` 渲染。工具调用结果会合并到对应的 tool-call part。
