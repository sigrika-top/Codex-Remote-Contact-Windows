# Codex Remote Contact Windows

在你自己的 Windows 电脑上运行的本地联系中枢。它把网页控制台、QQ / OneBot 和 Codex CLI 接到同一个本地服务里，用来查看状态、切换通道和生成回复。QQ 回复默认复用常驻的 Codex app-server 进程，并按聊天分别保存会话号。

macOS 原来依赖的 iMessage、Swift 客户端和 launchd 仍然留在项目里，但只在 macOS 上生效。

## 为什么从苹果系统改到 Windows

原项目是按 macOS 编写的。它读取本机 iMessage 数据库，用 AppleScript 控制「信息」和 Shadowrocket，用 launchd 常驻，并用 Swift / WebKit 做桌面窗口。这些接口只存在于苹果系统，不能在 Windows 上原样运行。

Windows 版本保留了不依赖苹果系统的部分：

- Node.js 主服务
- 网页控制台
- QQ / OneBot 消息通道
- Codex CLI 回复和远程执行

苹果系统才有的能力被明确停用，或换成 Windows 自己的能力：

| 原来在 macOS 上 | Windows 上 |
| :--- | :--- |
| iMessage | 不可用。使用 QQ / OneBot 或网页控制台。 |
| Shadowrocket 节点切换 | 只开关当前用户的系统代理。节点在你自己的代理客户端里切换。 |
| 内置屏幕背光 | 关闭显示器，并保持系统唤醒。 |
| launchd、`.command` | `modules/start-hub.bat` 与 `modules/stop-hub.bat`。 |
| Codex 桌面应用 | 优先使用 Codex CLI。桌面版找不到时，回复仍然走命令行。 |

这样做是为了在 Windows 上得到一个能启动、能配置、能说明边界的版本，而不是假装 iMessage 或 Shadowrocket 已经能在 Windows 上运行。

## 使用边界

请只在你自己拥有、或者已经获得明确授权的电脑上部署。

- QQ、OneBot 和 Codex 都使用你自己的账号，并遵守这些服务各自的条款。
- 远程执行会在运行本服务的那台电脑上工作。删除文件、改系统设置、发送外部消息和切换代理，都应该先由你确认。
- 不要用它访问不属于你的账号或设备，不要用它发送骚扰或垃圾消息，也不要把它暴露到没有访问控制的公网。
- 本项目与 Apple、腾讯、OpenAI 没有隶属或授权关系。Codex、iMessage、QQ 是各自权利人的名称。

网页控制台目前没有登录验证。`3789` 端口只应在本机或你信任的内网使用。需要从别处访问时，使用带身份验证的反向代理或 SSH 隧道，不要直接把端口公开到互联网。

## 环境

- Windows 10 或更高版本。在服务器上也可以使用带 Node.js 20 的 Linux。
- [Node.js](https://nodejs.org/) 20 或更高版本。
- Codex CLI。回复生成需要它。
- QQ 通道需要一个 OneBot 兼容桥，例如 LLOneBot 或 NapCat。只使用网页控制台时可以不安装。

## Windows 部署

1. 安装 Node.js 20 或更高版本，然后重新打开终端。
2. 进入克隆下来的项目目录。
3. 编辑 `data/settings.json`。填入你自己的 QQ 群号和管理员 QQ 号；暂时不用 QQ 时可以保持数组为空。

```json
{
  "qq": {
    "allowedGroups": [],
    "ownerUserIds": [],
    "bannedUserIds": []
  },
  "branding": {
    "assistantName": "assistant",
    "ownerLabel": "管理员",
    "assistantMentions": ["@assistant"]
  }
}
```

4. 安装并登录 Codex CLI。Windows 可以使用官方安装脚本：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

也可以使用 npm：

```powershell
npm install -g @openai/codex
```

安装后运行一次 `codex`，按提示登录你自己的 ChatGPT 账号。如果 `codex` 不在 `PATH` 中，启动前设置：

```powershell
$env:CODEX_CLI_PATH = "C:\path\to\codex.exe"
```

5. 启动：

```powershell
.\modules\start-hub.bat
```

6. 打开 [http://localhost:3789](http://localhost:3789)。

QQ 回复默认使用持久 `codex app-server`；同一私聊或群聊会续接原会话。会话号只保存在本机 `data/qq-sessions.json`。消息含图片时，Hub 会通过 OneBot 获取图片并交给模型；图片获取失败会请对方重发。

如果 Codex 需要走本机代理，在启动前设置代理地址，例如：

```powershell
$env:CODEX_REMOTE_CONTACT_PROXY_URL = "http://127.0.0.1:7890"
.\modules\start-hub.bat
```

没有代理时不要设置此变量。仓库不会替你启用代理或登录账号。

停止：

```powershell
.\modules\stop-hub.bat
```

QQ 桥默认地址是 `http://127.0.0.1:3000`。桥接器使用其他端口时：

```powershell
$env:ONEBOT_API_BASE = "http://127.0.0.1:3000"
.\modules\start-hub.bat
```

## 服务器上的部署

在你自己的服务器上，同样需要 Node.js 20 或更高版本。先安装依赖中的 Node.js，再把项目放到固定目录，配置 `data/settings.json`，然后运行：

```bash
node src/server.js
```

Windows 服务器使用 `modules\start-hub.bat`。

### 系统版本过低，装不上 Codex 桌面版

Codex 桌面应用对系统版本有要求。服务器系统过旧、没有图形界面，或者安装程序直接拒绝安装时，改为安装命令行版本。Hub 生成 QQ 回复时通过 `codex app-server` 与命令行组件通信，不需要桌面窗口。

Linux 或 macOS 服务器：

```bash
npm install -g @openai/codex
codex
```

Windows 服务器：

```powershell
npm install -g @openai/codex
codex
```

`npm` 不可用，但系统仍能运行官方安装脚本时，使用上一节的安装脚本。安装完成后确认终端里能执行 `codex --version`。命令不在默认路径时，用 `CODEX_CLI_PATH` 指向那个可执行文件，再启动 Hub。

服务器部署还需要：

- 用防火墙限制 `3789` 端口，只允许你自己的地址访问。
- 在服务器上单独登录 Codex CLI。登录状态保存在那台机器的用户目录，不会从你的个人电脑自动带过去。
- QQ 桥如果也运行在服务器上，把 `ONEBOT_API_BASE` 指到那台机器上的桥接地址。
- `modules/run-hub-task.ps1` 和 `modules/watch-hub.ps1` 可用于 Windows 计划任务托管；任务本身需要在目标电脑上单独注册。运行中的 QQ 客户端及交互式任务通常需要用户保持登录。

## 网页控制台

[http://localhost:3789](http://localhost:3789) 是日常使用的控制台。右上角箭头会打开 [http://localhost:3789/index.html](http://localhost:3789/index.html)，那里可以维护白名单和做本机 QQ 事件测试。

Windows 上的 iMessage 开关是关闭的，点击不会开启。这是预期行为。

## 常用指令

这些指令来自已授权的 QQ 管理消息。iMessage 指令格式仍保留在代码中，供 macOS 使用。

```text
/状态
/维护
/开启QQ
/关闭QQ
/白名单
/加群 群号
/删群 群号
/联网开
/联网关
/代理状态
/代理开
/代理关
/帮助
```

`/代理开` 和 `/代理关` 在 Windows 上切换的是当前用户的系统代理，不会切换 Clash、v2rayN 或其他客户端里的节点。

## 配置项

| 变量 | 作用 |
| :--- | :--- |
| `CODEX_CLI_PATH` | Codex 可执行文件的完整路径。 |
| `CODEX_APP_PATH` | Windows 桌面版 `Codex.exe` 的路径。只影响打开或退出桌面应用。 |
| `ONEBOT_API_BASE` | OneBot 桥接地址，默认 `http://127.0.0.1:3000`。 |
| `CODEX_REMOTE_CONTACT_CODEX_MODEL` | QQ 通道使用的模型。 |
| `CODEX_REMOTE_CONTACT_ASSISTANT_PROFILE_PATH` | 可选的助手语气说明文件，使用绝对路径。 |
| `CODEX_REMOTE_CONTACT_PROXY_URL` | QQ Codex 子进程和 Node 网络请求使用的代理地址；不设置时沿用系统环境变量或直连。 |
| `CODEX_QQ_TRANSPORT` | 默认使用常驻 app-server；设为 `exec` 可回退到逐条 CLI 调用。 |

模型名称以你的 Codex 账号当前可用的模型为准。

不要把服务器上实际使用的 `data/settings.json`、`data/qq-memory.json`、`data/qq-personas.json`、`data/qq-sessions.json`、`runtime/` 或 Codex 登录文件提交到 Git。仓库中现有的 JSON 是空白示例；部署时请在目标机器上单独配置和保存运行数据。

## 故障排查

| 现象 | 处理 |
| :--- | :--- |
| 网页打不开 | 确认已经运行 `start-hub.bat`，并访问 `http://localhost:3789`。 |
| 端口被占用 | 先运行 `stop-hub.bat`，再重新启动。 |
| Codex 显示路径缺失 | 安装命令行版本，或设置 `CODEX_CLI_PATH`。 |
| QQ 没有回复 | 确认 OneBot 桥已登录，地址和 `ONEBOT_API_BASE` 一致，群号已加入白名单，并且 QQ 开关已打开。 |
| iMessage 开关点不了 | Windows 不支持 iMessage。 |
| 代理节点没有变化 | Windows 版只切换系统代理。节点在代理客户端中切换。 |

## 项目结构

```text
src/server.js                         主服务
modules/web-console/public/           网页控制台
modules/start-hub.bat                 Windows 启动
modules/stop-hub.bat                  Windows 停止
modules/system-control/windows/       显示器和截图脚本
data/settings.json                    本机配置
```

`modules/mac-client`、`modules/macos-launcher`、`modules/imessage` 和 `modules/shadowrocket` 是 macOS 原有部分。在 Windows 上不需要构建它们。
