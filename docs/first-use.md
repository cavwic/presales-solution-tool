# First use · 首次使用

**V1.10.4** · [English](#user-content-first-use-english) · [简体中文](#user-content-first-use-chinese) · [Product home](../README.md)

<details name="first-use-language" open>
<summary><strong>English</strong></summary>

<a name="first-use-english"></a>

## 1. Obtain and install the tool

Open **[Download the tool](https://www.fiverr.com/wencong_chen/provide-my-presales-solution-tool-for-your-windows-workflow)**. This opens the Fiverr service page; delivery, version and licensing follow the applicable order.

Run the delivered installer, choose an installation folder and follow its progress. The online installer downloads and configures the desktop runtime, so allow an internet connection and enough disk space for the installed program. You do not need Node.js or a development server. Keep the installed files together if you later move the tool.

## 2. Find your way around

Open the desktop shortcut. The upper-right language control switches English/Chinese; the adjacent theme control switches light/dark appearance. The initial theme follows Windows. Drag a blank part of the top bar to move the window, and use its edges or the window controls to resize it.

The left navigation opens the five workflow stages. **Company library** holds reusable company materials; **Project materials** shows only the active project's files. The model row, **Import Skills** and **View outputs** stay at the top.

## 3. Create and configure a project

1. Select **New project**, enter a name and create it. The current project is saved before a separate project folder is created.
2. Fill in the project overview, objective and constraints. Use **Project settings** to review its folder, templates and output location.
3. Add local files with **＋** beside **Project materials**. Workflow imports can also choose files already in the current or another opened project. Cross-project reuse makes a copy rather than changing the source project.
4. Use **Open projects** to switch between loaded projects. **Project history** finds saved projects and can record submission status manually. Recording a status does not submit a bid.

## 4. Prepare company knowledge

1. Open **Company library → Company profile** and save verified company details.
2. Under **Documents**, select **Upload documents** or **Add material**. Choose a category and add tags, notes and an expiry date where relevant. The current per-file limit is 25 MB.
3. Select a document to inspect its original text and source location. A file marked **Needs OCR** has no usable parsed text for keyword search; prepare a readable version before relying on it.
4. Open **Search test**, enter words likely to occur in the original and select **Search**. Results show the file, location and excerpt. **View source** returns to the document.
5. Select **Add to current project** to make a project copy. Then choose that file as a reference in the workflow stage that needs it. Storing or searching a company file alone does not call a model.

Expiry warnings use the date you enter; check the certificate itself before using it. **Remove from library** requires confirmation and archives the entry while keeping the original. Copies already added to projects are unaffected. **Open folder** shows the library on disk.

## 5. Configure a model and Skills

| Mode | What to prepare |
| --- | --- |
| Local model | Start a compatible service such as Ollama or LM Studio, then enter its address and exact model ID. |
| Model plans | Use a supported signed-in client or a provider-authorized plan endpoint and credentials. A web-chat subscription does not automatically grant API access. |
| API | Enter your authorized endpoint, model ID and API key. The provider's usage fees apply. |
| Hybrid | Enable the needed channels and assign analysis, generation and image tasks to them. |

Test the connection and save the settings before generating. Use **Import Skills** to upload or install a supported Skill, inspect its content and enable it. Enabled instructions are shared across model modes; bundled scripts are not executed automatically.

## 6. Work through the stages

| Stage | First useful action |
| --- | --- |
| Presales | Add a communication node with its **＋**, attach the relevant information and record requested outputs. |
| Tender | Import tender/clarification documents, analyze the requirements and review each source before confirming it. |
| Bid | Choose the required documents, references and format templates, then generate and review the content. |
| Award handover | Split or add tasks, confirm ownership and acceptance criteria, and record changes. |
| Output files | Inspect and select the saved deliverables, then copy/export the files needed for delivery. |

Review generated text, requirements, source documents and file formatting before use. Procurement submission, signatures and seals remain outside the tool.

## 7. Save, clean up and update

Back up the project library, company knowledge library, external project folders and any settings you need before moving or updating the app. The app's folder buttons reveal the actual locations; settings are under `%APPDATA%\CavwicBidWorkbench`.

**File cleanup** scans first and asks for a selection and confirmation. Read the selected categories before continuing. Exporting selected deliverables is not a complete project or company-library backup. Exit the app before replacing an installation, and follow the delivery instructions for the current version.

</details>

<details name="first-use-language">
<summary><strong>简体中文</strong></summary>

<a name="first-use-chinese"></a>

## 1. 获取与安装

打开 **[工具下载](https://www.fiverr.com/wencong_chen/provide-my-presales-solution-tool-for-your-windows-workflow)**，跳转至 Fiverr 服务页面。交付版本、内容和授权以适用订单为准。

运行收到的安装器，选择安装位置并按提示完成安装。在线引导安装器会下载并配置桌面运行环境，需要联网，并为完整程序预留磁盘空间。无需另装 Node.js 或开发服务器。之后移动工具时，应保留完整运行文件。

## 2. 认识界面

从桌面快捷方式打开工具。右上角语言图标切换中英文，旁边的主题图标切换深浅色；首次主题跟随 Windows。拖动顶栏空白处移动窗口，通过边缘或窗口按钮调整大小。

左侧进入五个业务阶段。“企业知识库”保存可复用企业资料，“项目资料”只显示当前项目的文件。模型通道、“导入 Skills”和“查看输出”位于顶部。

## 3. 新建并设置项目

1. 点击“新建项目”，输入名称后创建。工具先保存当前项目，再建立独立项目目录。
2. 填写项目概况、业务目标和约束。在“项目设置”中检查资料位置、模板和输出位置。
3. 点击“项目资料”旁的“＋”上传本地文件。各阶段导入时，也可选择当前项目或其他已打开项目的已有资料；跨项目复用会复制文件，保留源项目。
4. 点击“项目列表”切换已载入项目。“历史项目”可搜索已保存的项目，并手动记录投递状态；记录状态不会执行投标提交。

## 4. 整理企业知识库

1. 打开“企业知识库 → 企业档案”，填写并保存经核实的企业信息。
2. 在“知识文档”点击“上传文档”或“新增资料”，选择分类，按需填写标签、备注和有效期。当前单个文件上限为25 MB。
3. 选择文档，查看原文及出处。标记“需 OCR”的文件暂时没有可用于关键词检索的正文，正式使用前应补齐可读版本。
4. 在“检索测试”输入原文可能出现的关键词并点击“检索”。结果显示文件名、位置和节选，点击“查看原文”回到资料。
5. 点击“加入当前项目”，将该资料复制为当前项目的独立副本；之后在所需阶段中选为参考资料。仅保存或检索企业资料不会调用模型。

有效期提醒按录入日期计算，正式使用前仍须核对证书原件。“移出知识库”需要确认，只归档条目并保留原文件，已经加入项目的副本不受影响。点击“打开文件夹”可在磁盘中查找原件。

## 5. 配置模型与 Skills

| 模式 | 需要准备 |
| --- | --- |
| 本地模型 | 先启动 Ollama、LM Studio 等兼容服务，再填写服务地址和准确的模型名称。 |
| 模型套餐 | 使用受支持的已登录客户端，或厂商允许调用的套餐接口及凭据；网页会员不等于 API 访问权限。 |
| API | 填写有权使用的接口地址、模型名称和 API Key，调用费用按服务商规则计算。 |
| 混合 | 启用需要的通道，并分别指定资料分析、文件生成和图像识别任务。 |

先测试连接并保存，再执行生成。“导入 Skills”支持导入受支持的指引，查看内容后按需启用。启用的指引供各模型模式使用，附带脚本不会自动执行。

## 6. 按阶段处理工作

| 阶段 | 开始操作 |
| --- | --- |
| 售前准备 | 在沟通栏点击“＋”建立节点，加入相关资料并记录需要输出的文件。 |
| 招标 | 导入招标、澄清文件，分析要求，逐项核对原文后确认。 |
| 投标 | 选择要编制的文件、参考资料及格式模板，生成后复核正文。 |
| 中标交底 | 分拆或新增任务，确认职责和验收标准，记录后续变更。 |
| 输出文件 | 检查已保存的成果，选择交付文件并复制或导出。 |

正式使用前，请核对生成内容、招标要求、依据原件和格式。采购平台提交、签字与盖章由使用者自行完成。

## 7. 保存、清理与更新

移动或更新工具前，备份项目资料库、企业知识库、外部项目目录及需要保留的配置。通过工具内的目录按钮查看实际位置，配置保存在 `%APPDATA%\CavwicBidWorkbench`。

“文件清理”先扫描，再由使用者选择并确认；执行前检查所选类别。导出部分交付文件不等于备份整个项目或企业知识库。替换安装前先退出程序，并遵循当前版本随附的更新步骤。

</details>
