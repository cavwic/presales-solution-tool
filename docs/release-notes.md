# V1.8.0 · Presales Solution Tool / 售前解决方案工具

Release date / 发布日期：2026-11-12

## English

V1.8.0 brings searchable project history and organized project folders to the current three-pane desktop workspace.

- Open project settings in a dedicated dialog with its own close button, keyboard focus, and scrolling.
- Search saved projects, filter manually marked submissions, open their folders, or load their materials and generated-file records into the workspace.
- Store projects in separate folders inside `项目资料库`, with stage folders, `项目说明.txt`, and a readable `历史项目索引.csv`.
- Save the current project before creating or opening another one. Consecutive new projects receive separate IDs and folders. Importing a ZIP whose project ID already exists creates an independent imported copy.
- Copy referenced files from existing external folders without moving or deleting the originals. Rescan reads changes from the active folder before updating the saved snapshot.
- Retain model modes, Skills, file cleanup, undo/redo, Chinese and English interfaces, and light/dark themes. The current layout also fixes workspace clipping and removes the duplicate communication-node action.
- Fix primary-button colors in both themes so action labels remain visible, including when an action is disabled.

### Updating and existing projects

Extract the complete portable package to a writable folder and run `售前解决方案工具.exe`. Portable apps keep `项目资料库` beside the EXE; source installations keep it at the tool root, outside the replaceable `release/` runtime. Keep this library when moving, backing up, or updating the tool. App settings remain under `%APPDATA%/CavwicBidWorkbench`.

To collect an older saved project, use **Project history → Add existing project** and choose its folder containing `workspace.json` and `projects/`. Existing history entries are kept. Missing files are reported; deleted or never-saved materials cannot be recovered by this feature. Marking a project as submitted records its status and does not submit it to a procurement portal.

The maintainer's separately retained original UI and data snapshot are local rollback material and are not included in the public portable package.

### Validation

All 299 unit, native-service, packaging, and license-notice checks passed. The installed V1.8.0 project-library suite passed all 12 checks; candidate and installed-path smoke checks each passed 12 checks. Coverage includes restart recovery, consecutive new projects, repeated ZIP imports, file-byte preservation, directory isolation, modal focus, bilingual short windows, and light/dark hover states. Tests use fictional projects and isolated profiles, with no real tender submission or model-output quality acceptance. The legacy web E2E suite is outside this release's validation scope. See [validation scope](https://github.com/cavwic/presales-solution-tool/blob/v1.8.0/docs/validation.md).

## 简体中文

V1.8.0 在当前三栏桌面工作台中加入历史项目查询，并将项目资料整理为可手动查找的独立目录。

- 项目设置改为独立弹窗，提供关闭按钮、键盘焦点管理和内部滚动。
- 历史项目可搜索、筛选手动标记的已投递项目、打开项目文件夹，以及载入资料和生成文件记录。
- 各项目独立保存在“项目资料库”，提供阶段文件夹、“项目说明.txt”和便于查看的“历史项目索引.csv”。
- 新建或打开另一项目前保存当前项目；连续新建使用独立标识和目录，导入已有项目的 ZIP 时建立独立“导入副本”。
- 既有外部目录只复制引用文件，原文件保留；重新扫描先读取当前目录中的修改，再更新存档。
- 保留模型通道、Skills、文件清理、撤销恢复、中英文和深浅主题；当前布局同时修复工作区裁切，移除重复的沟通节点入口。
- 修复深浅主题下主操作按钮底色与文字颜色的冲突，禁用状态也保持可辨认。

### 更新与已有项目

完整解压便携包到可写目录，再运行“售前解决方案工具.exe”。便携版在 EXE 旁建立“项目资料库”；源码安装版则在工具根目录建立，不放入会被替换的 `release/` 运行目录。移动、备份或更新工具时请保留资料库。应用设置仍位于 `%APPDATA%/CavwicBidWorkbench`。

旧项目从“历史项目 → 收录已有项目”添加，选择包含 `workspace.json` 和 `projects/` 的旧目录。已有记录保持不变，缺失文件会标注；已删除或从未保存的资料无法由此恢复。“已投递”仅为人工状态记录，不执行采购平台提交。

维护者本机另行保留的原版界面及独立数据快照不随公开便携包分发。

### 验证

单元、原生服务、构建及声明检查合计 299 项通过；V1.8.0 安装版项目资料库专项 12 项通过，候选和正式路径安装检查各 12 项通过。覆盖重启恢复、连续新建、重复 ZIP 导入、文件字节保留、目录隔离、弹窗焦点、中英短窗及深浅主题悬停状态。验证采用虚构项目和隔离配置，不代表真实投标提交或模型生成内容质量验收；旧网页端 E2E 未计入本次通过范围。详见 [验证范围](https://github.com/cavwic/presales-solution-tool/blob/v1.8.0/docs/validation.md)。

## Download integrity / 下载校验

`Presales-Solution-Tool-V1.8.0-win-x64.zip` — SHA-256:

```text
64e6b527668642a3659db3b60ac60492dcabba7866c0b4c4bd9836a8d14f3bc3
```

[Releases](https://github.com/cavwic/presales-solution-tool/releases) · [Update guide / 更新步骤](https://github.com/cavwic/presales-solution-tool/blob/v1.8.0/docs/releases.md) · [Changelog / 变更记录](https://github.com/cavwic/presales-solution-tool/blob/v1.8.0/CHANGELOG.md)
