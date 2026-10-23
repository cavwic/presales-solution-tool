# Skills

模型行后方的「导入 Skills」用于管理指引。导入一次后，本地模型、模型套餐、API 和混合模式共用同一份启用列表。

## 导入和启用

1. 上传 UTF-8 `SKILL.md`、只包含一个 Skill 的 ZIP，或填写公开 GitHub 的 Skill 目录、`SKILL.md`、单 Skill ZIP 地址。
2. 查看指引、来源和受支持的参考文本。
3. 在列表中启用所需 Skill。新导入默认禁用，同名内容不会覆盖现有文件。

`SKILL.md` 至少包含 `name`、`description` 和正文。例如：

```markdown
---
name: project-review
description: Review project requirements against supplied evidence.
---
Keep source facts, assumptions and unresolved items separate.
```

仓库中的 `skills/` 提供本项目工作流指引，可作为格式参考。第三方 Skill 应先核对许可和内容；公开可下载并不自动表示允许复制或再分发。

![Skills 内容预览](images/skills-manager.en.png)

*截图中的 Skill、说明和项目均为虚构验收数据。*

## 实际使用范围

启用的指引和可用参考文本会作为任务上下文提供给模型，项目事实与当前任务要求优先。导入 Skill 不会增加工具权限，也不保证模型遵循所有指引。

附带脚本保持不执行；依赖、二进制资源和不支持的附件不会自动安装或加载。需要这些能力的完整 Skill 工作流，应在具备相应工具和授权的环境中另行运行。

## 限额

| 内容 | 限额 |
| --- | --- |
| `SKILL.md` | 128 KB，UTF-8 |
| ZIP 上传 | 16 MB |
| ZIP 解压内容 | 12 MB、128 项 |
| 单个指引进入上下文 | 16,000 字符 |
| 单份参考进入上下文 | 4,000 字符 |
| 合计上下文 | 32,000 字符 |

上下文超出限额时使用节选；导入成功不代表全部文本会进入每次请求。联网安装只访问支持的公开 GitHub 地址，不使用 GitHub 令牌。私有仓库、其他来源或包含多个 Skill 的整仓包，可先自行准备为单 Skill 文件后上传。

## 数据与许可

导入内容及启用状态保存在 `%APPDATA%/CavwicBidWorkbench/tool-skills`，普通缓存清理不会删除。启用后，指引会随请求提供给选定模型服务，因此应同样检查其中是否包含内部资料。

本项目自有内容的许可见 [CONTENT-LICENSE.md](../CONTENT-LICENSE.md)。用户导入的第三方 Skill 保留原许可，不因本工具提供导入功能而获得新的复制、使用或分发许可。仓库及发行包不包含运行测试时下载的第三方 Skill。
