# 售前解决方案工具

面向 Windows 的本地售前工作台，用于整理客户需求、分析招标文件、生成技术文件和跟踪中标交底。资料保存在所选项目目录，生成时使用自己配置的本地模型或授权模型接口；输出需人工复核。

## 开始使用

1. 从 [Releases](https://github.com/cavwic/presales-solution-tool/releases) 下载 Windows x64 便携包，完整解压。
2. 双击解压目录中的 `售前解决方案工具.exe`，选择项目目录。
3. 在顶部配置模型，导入资料后开始工作。便携版自带界面运行环境，无需 Node.js 或网页开发服务。

本机源码目录的根启动器会打开 `release/售前解决方案工具-win-x64/售前解决方案工具.exe`。移动软件时保留完整目录；原位更新见 [发行说明](docs/releases.md)。本机只保留当前稳定运行版及对应便携包。

## 功能

- 售前准备、客户沟通、招标要求分析、技术标组包与中标交底。
- 资料、参考依据、模板和生成文件统一管理，支持目录与 ZIP 输出。
- 本地模型、模型套餐、API、混合四种模式；混合模式按任务分工，请求失败时保留当前通道。
- 导入 `SKILL.md`、单 Skill ZIP 或公开 GitHub Skill，查看后启用，供所有模型模式共用。
- 中文和英文界面、深浅主题、自适应窗口，以及可选择范围的文件清理。

工具支持准备和审核文档；采购平台提交、签字和盖章由用户自行办理。

![Skills 管理界面](docs/images/skills-manager.zh.png)

*截图使用虚构验收数据，只展示界面和操作，不代表真实项目的生成效果。*

## 模型和数据

| 模式 | 接入方式 |
| --- | --- |
| 本地模型 | Ollama、LM Studio、其他 OpenAI Chat Completions 兼容服务 |
| 模型套餐 | 已登录的 Codex、MiniMax 订阅 Key、厂商授权的兼容接口 |
| API | 自己配置的兼容接口、模型 ID 与 API Key |
| 混合 | 为资料分析、文件生成和图像识别分别选择已启用通道 |

模型接口和网页会员的额度依厂商规则区分。服务商预设只提供协议与地址，具体接入见 [模型配置](docs/model-setup.md)。

项目资料保存在用户选择的目录；应用设置位于 `%APPDATA%/CavwicBidWorkbench`。请求会把当前任务资料和已启用的 Skills 指引交给所选模型服务。接口密钥只保留在当前应用会话，退出后清空。

## 文档与开发

- [离线使用说明](docs/使用说明.txt)
- [模型配置](docs/model-setup.md) · [Skills](docs/skills.md)
- [开发与构建](docs/development.md) · [验证范围](docs/validation.md)
- [发行与原位更新](docs/releases.md) · [V1.6.0 发行说明](docs/release-notes.md) · [变更记录](CHANGELOG.md)

```powershell
npm ci
npm run check
npm test
```

桌面构建、运行时依赖和安装后验证入口见开发文档。验证采用虚构项目及隔离配置；测试通过不等同于真实招标文件的内容质量验收。

软件代码采用 [MIT](LICENSE)；本项目自有 Skill、说明和模板采用 [CC BY 4.0](CONTENT-LICENSE.md)。第三方导入内容保留其原许可。
