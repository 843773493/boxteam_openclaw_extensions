# OpenClaw 插件发布与安装规范

插件可扩展 channels、model providers、tools、skills、speech、image generation 等能力

## Realtime Background Assistant 发布与安装规范

本文总结了在 Windows + npm 全局安装 openclaw 场景下的实操经验，目标是：

- 开发调试稳定（不因安装流程影响开发节奏）
- 功能完成后可重复发布
- 避免重复安装、安装失败、状态不一致

### 1. 开发阶段

开发时按当前约定，仅通过 `.vscode/launch.json` 启动调试流程，不依赖反复执行插件安装。

建议：

- 调试使用 launch 配置
- 代码改动后重启调试会话验证
- 不在每次改动后执行 `plugins install`

### 2. 发布阶段（推荐脚本）

在 `realtime-background-assistant/package.json` 中已提供以下脚本：

- `pack:plugin`：清理旧 tgz 后重新打包
- `publish:openclaw`：先卸载旧版本，再安装新包并 inspect 校验
- `publish:openclaw:force`：跳过卸载直接安装（仅在确认无冲突时使用）

执行命令：

```cmd
npm --prefix realtime-background-assistant run publish:openclaw
```

如果你是向 npm registry 发布当前包，则执行：

```cmd
cd realtime-background-assistant
npm publish --access public
```

发布前建议确认两件事：

- 包名使用你自己的 scope，例如 `@lain14138/realtime-background-assistant`
- `files` 白名单已经排除了测试文件和历史打包产物

### 2.1 npm 配置整理建议

为了避免旧凭据干扰发布，建议用户级 `~/.npmrc` 只保留非敏感配置，例如：

- `@lain14138:registry=https://registry.npmjs.org/`
- 超时、代理等通用网络设置

不要把长期有效的 `_authToken` 明文写进用户级 `.npmrc`。更稳妥的做法是：

- 将 token 放到临时环境变量或受控的密钥管理里
- 发布时通过当前会话注入 `NPM_TOKEN`
- 必要时用临时 userconfig 做隔离验证

这次排查里，`npm whoami` 可以通过，但正式 `npm publish` 曾被用户目录下旧配置干扰；后来改用临时 userconfig 只读取当前 token 后，发布成功。

### 3. 为什么这样做

- `npm pack` 可得到可追溯的发布产物（tgz）
- 先卸载再安装可避免 duplicate plugin id 与残留记录
- 末尾 `inspect --json` 作为发布成功的最终判据

### 4. 成功判据

安装后执行：

```cmd
openclaw plugins inspect realtime-background-assistant --json
```

至少满足：

- `id` 为 `realtime-background-assistant`
- `status` 为 `loaded`
- `source` / `install` 信息与预期发布路径一致

### 5. 常见问题与处理

1. `duplicate plugin id detected`

- 含义：同一插件 ID 同时从多个来源加载（例如 config path + extensions）
- 处理：保留一种来源；推荐发布时使用 `publish:openclaw`（先卸载再安装）

1. Windows 下 `EPERM ... rename`（复制安装失败）

- 含义：安装阶段目录重命名失败，常见于占用或权限拦截
- 处理：
  - 关闭占用插件目录的相关进程后重试
  - 若仍失败，可先使用 link 方式继续开发，发布时再走打包安装

1. `Plugin not found` 但脚本返回码看似成功

- 可能原因：命令链中中间步骤异常未被及时识别
- 处理：必须以 `inspect` 的有效输出作为最终依据，不只看退出码

1. `403 Forbidden` 且提示 `Two-factor authentication or granular access token with bypass 2fa enabled is required`

- 含义：当前用于发布的 npm 凭据没有通过 npm 的写入授权检查
- 排查顺序：
  - 先确认 token 本身能通过 `npm whoami`
  - 再确认发布时没有被用户级 `.npmrc` 的旧 token 覆盖
  - 最后确认 token 已勾选 `Bypass 2FA`，并且对目标包有 `Read and write` 权限
- 处理：用临时 userconfig 隔离验证，必要时清理用户级 `.npmrc` 里的旧 `_authToken`

### 6. 推荐团队约定

- 开发：只走 launch 调试
- 发布：统一用 `npm --prefix realtime-background-assistant run publish:openclaw`
- 验收：必须附 `inspect --json` 结果截图或片段
