# pi-sdk-test

opencode-go 终端对话助手（单文件 `test.ts`）。

## 运行（cmd / PowerShell 均可）

```bat
cd /d D:\mycode\workflow_project\pi-sdk-test
node test.ts
```

需要 Node 22.19+，依赖已安装（`npm i @earendil-works/pi-coding-agent`）。

## 配置

编辑 `config.json`，无需环境变量：

```json
{
  "model": "deepseek-v4.1-flash",
  "apiKey": "sk-...",
  "dataDir": "./data"
}
```

- `model`：opencode-go 的模型 id，省略时为 `deepseek-v4.1-flash`。
- `apiKey`：opencode-go 的 API key，必填。
- `dataDir`：数据目录，相对路径按运行目录解析，默认 `./pi-chat-data`。

`config.json` 不存在时会自动生成模板并提示填写。

## 数据目录

```
data/
  auth.json          与 ~/.pi 隔离的 pi 凭据
  sessions/*.jsonl   会话历史，每次启动自动续接最近一次会话
```

输入消息回车发送，输入 `/exit` 退出。

## 注意

`config.json` 里是明文 API key，不要提交到 git 或发给别人。
