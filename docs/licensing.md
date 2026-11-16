# Licensing · 授权说明

[English](#user-content-licensing-english) · [简体中文](#user-content-licensing-chinese) · [Product home](../README.md)

<details name="licensing-language" open>
<summary><strong>English</strong></summary>

<a name="licensing-english"></a>

## Three-day trial and paid plans

**V1.11.0** starts a **72-hour trial on first local launch**. Existing parsing, document generation, deviation-table and checking features are available during the trial. The three paid plans have identical features; only the licensed term differs.

| Plan | Price | Term |
| --- | --- | --- |
| Trial | Free | 72 hours from first local launch |
| Monthly | **$10** | One calendar month |
| Annual | **$90** | One calendar year |
| One-time purchase | **$170** | Continued use of the delivered version within the licensed version range |

| Feature | During trial | Active paid license | After expiry |
| --- | --- | --- | --- |
| Existing parsing, generation, deviation tables and checks | Available | Available | View existing projects/files only |
| Word / PDF exports | Trial watermark | No trial watermark on new exports | Existing files remain viewable |
| Whole-library backup | Unavailable | Available | Unavailable |
| Project-package import/export | Unavailable | Available | Unavailable |
| Company-asset package sharing | Unavailable | Available | Unavailable |

After the trial or a fixed-term license expires, saved projects and files remain viewable. Import a valid license to resume editing and generation. Expiry does not erase your materials. Fixed-term orders do not renew automatically. Terms use UTC calendar dates and handle month-end; unless the order expressly agrees otherwise, arrange the license start to match delivery.

The one-time plan covers its delivered version range. Unlimited future versions, maintenance and support are not included by default. The standard license does not add a fixed device count; installation binding is off by default. Any different user, organization, device or deployment scope must be expressly agreed in the order.

## Purchase and activation

Open **[Download the tool](https://www.fiverr.com/wencong_chen/provide-my-presales-solution-tool-for-your-windows-workflow)**. This is the Fiverr service page for delivery and licensing, not a public installer mirror. After manually verifying the order, the seller provides an Ed25519-signed license file. Open **Trial and licensing**, choose that file or paste its complete content, and select **Verify and activate**.

Verification runs locally; the client contains the issuer's public key, not its private key. No automated Fiverr-payment integration or licensing-server sign-in is connected. Local protection and clock checks do not make the application tamper-proof and cannot prevent every same-user program change, state reset or reinstallation. License-file signing is separate from Windows installer/EXE code signing, which is not implemented in this release.

## Exports, backups and user data

The project PDF export reflows the project's Markdown text onto A4 pages. It is not a layout-preserving Word-to-PDF converter. After activation you can export it again without another model call. Watermarks already baked into historical PDFs are not removed losslessly; create a new PDF from the project text. Export policies do not modify source files or remove third-party watermarks.

A whole-library backup is a local ZIP snapshot of the app-managed project and company libraries, with file sizes and SHA-256 values for manual recovery. It does not follow external project-folder bindings or include model settings from AppData. Back up external originals and any required settings separately. Company-asset packages contain active company records and their originals, excluding archived/removed items. Sharing is by offline file, with your confirmation; no cloud collaboration service is provided.

The license permits personal/internal business work and commercial delivery of generated proposal documents to clients. It does not independently authorize resale or redistribution of the application or its standalone template/Skill library. Standard delivery does not include commercial source code. Software prices exclude models, API credits, tokens, hosted inference and computing resources.

Versions expressly adopting the **Cavwic Commercial Software License 1.0**, beginning with V1.10.4, follow the full license supplied with the tool and the applicable order. Earlier MIT code and CC BY 4.0 content retain their covered rights. Third-party runtimes, fonts, dependencies, models and imported Skills retain their own licenses. This page and the [repository notice](../LICENSE) do not withdraw earlier grants or replace the delivered software license.

</details>

<details name="licensing-language">
<summary><strong>简体中文</strong></summary>

<a name="licensing-chinese"></a>

## 三天试用与付费套餐

**V1.11.0** 从**首次本机启动起提供72小时试用**。试用期内可使用现有解析、文件生成、偏离表和检查功能。三个付费套餐功能相同，只区分授权期限。

| 套餐 | 价格 | 期限 |
| --- | --- | --- |
| 免费试用 | 免费 | 首次本机启动后72小时 |
| 一个月 | **$10** | 一个日历月 |
| 一年 | **$90** | 一个日历年 |
| 一次性买断 | **$170** | 持续使用授权版本范围内的交付版本 |

| 功能 | 试用期内 | 有效付费授权 | 到期后 |
| --- | --- | --- | --- |
| 现有解析、生成、偏离表和检查 | 可用 | 可用 | 仅查看已有项目和文件 |
| Word／PDF 导出 | 带试用水印 | 新导出不带试用水印 | 已有文件仍可查看 |
| 整库备份 | 不可用 | 可用 | 不可用 |
| 项目包导入导出 | 不可用 | 可用 | 不可用 |
| 企业资产包共享 | 不可用 | 可用 | 不可用 |

试用或固定期限授权到期后，已有项目和文件仍可查看；导入有效授权后恢复编辑和生成。到期不清除资料。期限套餐不自动续费，按 UTC 日历日期计算并处理月末；订单无其他明确约定时，应安排授权起始日与交付日一致。

买断覆盖授权范围内的交付版本，不当然包含无限未来版本、维护或支持。标准许可不另设固定设备数，默认不绑定安装标识；订单若有不同的使用人、组织、设备或部署范围，须另行明确约定。

## 购买与激活

通过 **[工具下载](https://www.fiverr.com/wencong_chen/provide-my-presales-solution-tool-for-your-windows-workflow)** 打开 Fiverr 服务页面安排交付和授权，该链接不是公开安装包镜像。卖家人工核实订单后提供 Ed25519 签名授权文件。在“试用与授权”中选择文件或粘贴完整内容，再点击“验证并激活”。

授权在本机验证，客户端只带发证公钥，不带签名私钥。未接入 Fiverr 自动付款接口，也无需登录授权服务器。本机状态保护和日期检查不保证防破解，不能彻底防止同一用户修改程序、清空状态或重装。授权文件签名与 Windows 安装器／EXE代码签名是两回事，后者本版尚未实施。

## 导出、备份与数据

项目 PDF 导出按项目 Markdown 正文重新排为 A4，不能保真还原 Word 的原版式。付费激活后可直接重导，不需要再次调用模型；历史 PDF 中已烘焙的水印不会无损消失，应从项目正文生成新 PDF。导出策略不修改源文件，也不删除第三方水印。

“整库备份”是工具管理的项目库和企业库的本地 ZIP 快照，附带文件大小和 SHA-256 清单，供手动恢复；不跟随外部项目目录绑定，也不包含 AppData 模型配置。外部原件和必要设置仍须另外备份。“企业资产包”只含仍在库中的企业档案、资料记录及原件，不含已移除的归档资料。用户确认后以离线文件分享，未提供云端协作服务。

现有许可允许个人／内部业务使用，并向客户商业交付生成方案等文档；不等于另行授予分发或转售应用程序、独立模板库或 Skill 库的权利。标准交付不含商业源代码。软件价格不含模型、API 额度、Token、云推理和算力费用。

从 V1.10.4 起明确采用 **Cavwic 商业软件使用许可 1.0** 的版本，适用随工具交付的完整许可及订单。此前 MIT 代码和 CC BY 4.0 内容保留其覆盖范围内的权利；第三方运行时、字体、依赖、模型和导入 Skill 仍适用各自许可。本页及[仓库声明](../LICENSE)不撤回历史授权，也不替代交付版本附带的完整许可。

</details>
