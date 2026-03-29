非用户主动要求，默认采取行为

1、用中文和用户交流，也包括使用工具时的描述、编写的代码中的注释文本。

2、初次实现功能时减少try except等防御性编程，以实现核心功能为主。

3、如果出现网络问题，使用代理端口10809。

4、在实现 realtime-background-assistant 插件时，先查看 [docs/realtime-background-assistant.md](../docs/realtime-background-assistant.md)。

5、`reference_repo` 只是参考仓库，只读使用，不要在其中编辑、修改或提交。

6、`docs` 用于存放项目相关文档、规范、开发约定和验收说明，新增或修改说明优先放在这里。

## 根目录说明

当前仓库根目录下的顶层文件和文件夹职责如下：

- [.env](../.env)：本地环境变量配置，通常包含运行、调试或发布所需的私有配置，不应随意外提。
- [.git/](../.git)：Git 仓库元数据目录，用于版本控制，不作为业务代码或文档修改对象。
- [.github/](../.github)：Copilot 指令、工作流配置和其他仓库级自动化配置的存放位置。
- [.gitignore](../.gitignore)：Git 忽略规则，控制哪些临时文件、构建产物和本地配置不应被提交。
- [.openclaw-debug/](../.openclaw-debug)：本地调试产物或临时调试数据目录，通常由调试流程自动生成。
- [.vscode/](../.vscode)：VS Code 工作区配置目录，保存编辑器相关设置、调试配置和任务定义。
- [docs/](../docs)：项目文档目录，存放插件说明、开发规范、联调约定和验收标准。
- [realtime-background-assistant/](../realtime-background-assistant)：实际的 OpenClaw 插件实现目录，包含源码、发布脚本、配置和测试。
- [reference_repo/](../reference_repo)：参考仓库目录，仅用于对照设计、实现和行为，不作为本仓库的编辑目标。

## 工作约定

- 需要理解插件行为时，优先查看 `docs` 下的相关文档，再回到 `realtime-background-assistant` 目录改代码。
- 如果任务涉及参考实现，只能读取 `reference_repo`，不要把修改带到这里。
- 如果任务涉及发布、调试或联调，优先检查根目录下是否已有对应配置或脚本，再决定是否新增文件。
