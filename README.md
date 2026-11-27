# pi harness

极简的本地 coding agent harness，基于 **Next.js + Electron + pi SDK + assistant-ui**。

## 功能

- 配置 `opencode-go` 的 API Key 与模型 ID
- 选择 / 切换工作目录（桌面端打开原生目录选择器）
- 多会话：新建、切换、删除；历史存为 JSONL，重启后可继续

## 运行

需要 Node.js 22.19+。

```bash
npm install

# 桌面端：自动拉起 Next.js（没有构建产物时用 dev 模式）
npm run desktop

# 或者只跑 Web（浏览器打开 http://127.0.0.1:4311）
npm run dev
npm run build && npm run start
```

首次启动会弹出设置，填入 opencode-go API Key 和模型 ID（默认 `deepseek-v4.1-flash`），
在侧边栏点击工作目录即可切换。

## 数据目录

默认是仓库下的 `./data`，可用环境变量 `HARNESS_DATA` 覆盖：

```
data/
  config.json          apiKey / model / cwd（明文，勿提交）
  agent/auth.json      与 ~/.pi 隔离的 pi 凭据
  sessions/*.jsonl     所有会话（跨工作目录）
```

## 代码结构

```
app/page.tsx                    会话列表、设置、目录选择
components/chat.tsx             assistant-ui 聊天界面（external store runtime）
app/api/config                  读写配置
app/api/sessions                列出 / 新建会话
app/api/sessions/[id]           发送消息、中止、删除
app/api/sessions/[id]/events    SSE：sync / delta 事件
lib/harness.ts                  pi SDK：模型运行时、活跃会话、消息映射
electron/main.cjs               启动（或复用）Next 服务 + 窗口 + 目录选择 IPC
electron/preload.cjs            暴露 window.harness.pickDirectory
```

一轮对话的流程：`POST /api/sessions/[id]` 在后台调用 `session.prompt()`，
pi 的事件流被转换成 SSE：文本增量发 `delta`，消息/工具状态变化发全量 `sync`，
客户端交给 `useExternalStoreRuntime` 渲染。工具调用结果会合并到对应的 tool-call part。
