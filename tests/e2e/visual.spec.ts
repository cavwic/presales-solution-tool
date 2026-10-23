import { expect, test } from "@playwright/test";
import { selectProjectDirectory } from "./helpers";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(overflow.page, `page width ${overflow.page} exceeded viewport ${overflow.viewport}`).toBeLessThanOrEqual(overflow.viewport + 1);
}

test("workbench remains stable across lifecycle pages", async ({ page }, testInfo) => {
  for (const path of ["/", "/requirements", "/bid-package"]) {
    await page.goto(path);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator(".solution-app")).toHaveAttribute("data-ready", "true");
    await expectNoHorizontalOverflow(page);
  }
  await page.screenshot({ path: testInfo.outputPath("solution-workbench-light.png"), fullPage: true });
});

test("theme and language controls preserve a dense responsive layout", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
    localStorage.setItem("cavwic-lab-theme", "light");
  });
  await page.reload();
  const globalControls = page.locator(".lab-header nav > *");
  await expect(globalControls).toHaveCount(5);
  await expect(globalControls.nth(0)).toHaveAttribute("aria-label", "撤销（最多三步）");
  await expect(globalControls.nth(1)).toHaveAttribute("aria-label", "恢复（最多三步）");
  await expect(globalControls.nth(2)).toHaveAttribute("aria-label", "切换到深色模式");
  await expect(globalControls.nth(3)).toHaveAttribute("aria-label", "Switch to English");
  await expect(globalControls.nth(4)).toHaveAttribute("aria-label", "模型配置 / Model configuration");
  await expect(page.locator(".workspace-toolbar").getByRole("button")).toHaveCount(2);
  await page.getByRole("button", { name: /招标/ }).click();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "投标", exact: true }).click();
  await expect(page.getByRole("heading", { name: "投标文件输出" })).toBeVisible();
  await expect(page.getByText("招标要求分析生成投标文件清单后，文件会同步显示在这里。")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("bid-package-dark-zh.png"), fullPage: true });
  await page.getByRole("button", { name: "招标" }).click();
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Solution Project Workbench");
  await expect(page.getByText("TENDER INPUT / PREPROCESSING")).toBeVisible();
  await expect(page.getByRole("link", { name: "模型配置 / Model configuration" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("requirements-dark-en.png"), fullPage: true });
});

test("project settings opens without changing the active workflow stage", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
    localStorage.setItem("cavwic-lab-theme", "light");
  });
  await page.reload();
  await page.getByRole("button", { name: "招标" }).click();
  await expect(page.getByRole("heading", { name: "招标文件", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "项目设置" }).click();
  await expect(page.getByRole("heading", { name: "项目设置" })).toBeVisible();
  await expect(page.getByLabel("项目路径")).toHaveValue("");
  await expect(page.locator(".general-template-grid > article")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "招标文件", exact: true })).toBeVisible();
  const projectSettingsButton = page.getByRole("button", { name: "项目设置", exact: true });
  await projectSettingsButton.hover();
  await expect(projectSettingsButton).toHaveCSS("color", "rgb(255, 255, 255)");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("project-settings-tender-zh.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { name: "Project settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tender files", exact: true })).toBeVisible();
});

test("tender preprocessing and clarification workspace stays readable", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
    localStorage.setItem("cavwic-lab-theme", "light");
  });
  await page.reload();
  await page.getByRole("button", { name: "招标" }).click();
  await page.locator('#tender-files input[type="file"]').setInputFiles([
    { name: "正式招标文件-技术与验收要求.txt", mimeType: "text/plain", buffer: Buffer.from("投标人应提交技术方案、部署手册、验收方案及完整进度计划。") },
    { name: "扫描版资格证明附件.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) },
  ]);
  await page.locator("#tender-files .tender-file-toolbar").getByRole("button", { name: "预处理" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "否" }).click();
  await page.getByRole("button", { name: "新增澄清节点" }).click();
  const clarification = page.locator(".clarification-row").first();
  await clarification.getByLabel("澄清节点名称").fill("第一次澄清及补遗");
  await clarification.locator("label.file-command", { hasText: "导入澄清文件" }).locator("input[type=file]").setInputFiles({ name: "交付周期澄清.txt", mimeType: "text/plain", buffer: Buffer.from("交付周期最终调整为 60 天，以本澄清文件为准。") });
  await page.getByRole("button", { name: "技术参数", exact: true }).click();
  await page.getByLabel("招标分析要求").fill("提取投标时间、技术参数、评标办法、资质和文件清单，保留来源位置。");
  await page.getByLabel("招标分析文件格式").selectOption("md");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("tender-workspace-zh.png"), fullPage: true });
});

test("bid file output editor remains readable and switches language immediately", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
  });
  await page.reload();
  await expect(page.locator(".solution-app")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    const stored = localStorage.getItem("cavwic-solution-workspace");
    if (!stored) throw new Error("PROJECT_NOT_STORED");
    const project = JSON.parse(stored) as { bidFileChecklist: unknown[] };
    project.bidFileChecklist = [
      { id: "visual-technical", title: "技术方案及实施计划", category: "technical", status: "pending", sourceResultId: "analysis-visual", notes: "来自招标文件第三章与澄清文件" },
      { id: "visual-acceptance", title: "工厂及现场验收方案", category: "delivery", status: "pending", sourceResultId: "analysis-visual", notes: "覆盖 FAT、SAT 与遗留项关闭" },
    ];
    localStorage.setItem("cavwic-solution-workspace", JSON.stringify(project));
  });
  await page.reload();
  await page.getByRole("button", { name: "投标", exact: true }).click();
  const item = page.locator(".bid-output-list > article").first();
  await item.locator(".bid-output-summary").click();
  await item.getByLabel("输出格式 技术方案及实施计划").selectOption("docx");
  await item.getByLabel("细节要求 技术方案及实施计划").fill("按招标章节顺序说明总体架构、实施步骤、项目边界、验收方法和待确认事项。");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("bid-output-editor-zh.png"), fullPage: true });

  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { name: "Bid file output" })).toBeVisible();
  await expect(item.getByText("File template", { exact: true })).toBeVisible();
  await expect(item.getByRole("button", { name: "Generate file" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("presales communication workspace remains readable", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
    localStorage.setItem("cavwic-lab-theme", "light");
  });
  await page.reload();
  await selectProjectDirectory(page, "售前视觉测试项目");
  await page.getByRole("button", { name: "新增沟通节点" }).click();
  await page.getByRole("button", { name: "新增执行项" }).click();
  const round = page.locator(".presales-round").first();
  const disabledAnalysisButton = round.getByRole("button", { name: "需求分析" });
  const disabledBatchButton = round.getByRole("button", { name: "批量生成文件" });
  await expect(disabledAnalysisButton).toBeDisabled();
  await expect(disabledAnalysisButton).toHaveCSS("cursor", "default");
  await expect(disabledBatchButton).toBeDisabled();
  await expect(disabledBatchButton).toHaveCSS("cursor", "default");
  const node = round.locator(".round-node");
  await node.getByRole("textbox", { name: "参会人员", exact: true }).fill("客户项目经理");
  await node.getByRole("button", { name: "新增参会人员" }).click();
  await node.getByLabel("参会人员类别").selectOption("internal");
  await node.getByRole("textbox", { name: "参会人员", exact: true }).fill("解决方案负责人");
  await node.getByRole("button", { name: "新增参会人员" }).click();
  await round.locator("label.file-command", { hasText: "导入客户附件" }).locator("input[type=file]").setInputFiles({ name: "客户技术要求.txt", mimeType: "text/plain", buffer: Buffer.from("额定负载 5 kg。") });
  await round.getByRole("button", { name: "技术参数", exact: true }).click();
  await round.getByLabel("分析要求").fill("提取参数并保留来源位置。");
  await round.locator(".round-needs label.file-command", { hasText: "上传模板" }).locator("input[type=file]").setInputFiles({ name: "分析模板.md", mimeType: "text/markdown", buffer: Buffer.from("# 技术参数\n# 来源") });
  await round.locator(".round-needs .template-source-list > div > button:first-child").click();
  await round.getByLabel("分析结果文件格式").selectOption("md");
  const action = round.locator(".round-action-row").first();
  await action.getByLabel("响应文件名称").fill("本轮客户响应");
  await action.getByLabel("响应文件格式").selectOption("md");
  await action.getByLabel("截止时间").fill("2026-09-01");
  await action.locator("label.file-command", { hasText: "上传模板" }).locator("input[type=file]").setInputFiles({ name: "响应模板.md", mimeType: "text/markdown", buffer: Buffer.from("# 需求理解\n# 响应方案\n# 待确认边界") });
  await action.locator(".template-source-list > div > button:first-child").click();
  await expect(page.getByRole("heading", { name: "客户沟通与文件响应" })).toBeVisible();
  await expect(page.getByLabel("响应文件格式")).toBeVisible();
  await expect(page.getByLabel("截止时间")).toBeVisible();
  await expect(action.getByText("响应模板.md", { exact: true })).toBeVisible();
  await expect(page.getByLabel("文件要求")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成任务", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成文件", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批量生成任务" })).toHaveCount(0);
  await page.getByRole("button", { name: "生成文件", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").screenshot({ path: testInfo.outputPath("model-action-choice-zh.png") });
  await page.getByRole("alertdialog").getByRole("button", { name: "否，输出任务" }).click();
  await expectNoHorizontalOverflow(page);
  await node.screenshot({ path: testInfo.outputPath("communication-participants-zh.png") });
  await round.locator(".round-needs").screenshot({ path: testInfo.outputPath("customer-analysis-config-zh.png") });
  await page.locator(".round-action-row").first().screenshot({ path: testInfo.outputPath("presales-action-fields-zh.png") });
  await page.screenshot({ path: testInfo.outputPath("presales-rounds-zh.png"), fullPage: true });
});

test("output file hierarchy remains readable and localizes immediately", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
    localStorage.setItem("cavwic-lab-theme", "light");
  });
  await page.reload();
  const outputView = page.getByRole("button", { name: "输出文件", exact: true });
  await selectProjectDirectory(page, "输出文件视觉测试项目");
  await page.getByRole("button", { name: "新增沟通节点" }).click();
  const round = page.locator(".presales-round").first();
  await round.locator("label.file-command", { hasText: "导入客户附件" }).locator("input[type=file]").setInputFiles({ name: "客户技术规格与验收要求-正式版.txt", mimeType: "text/plain", buffer: Buffer.from("技术规格与验收要求") });
  await round.locator("label.file-command", { hasText: "导入其他参考文件" }).locator("input[type=file]").setInputFiles({ name: "产品技术建议书-参考资料.md", mimeType: "text/markdown", buffer: Buffer.from("# 产品技术建议书") });
  await outputView.click();
  await expect(page.locator(".output-stage-group")).toHaveCount(1);
  await expect(page.locator(".output-module-group")).toHaveCount(2);
  await page.getByLabel("选择所有输出文件").check();
  await expect(page.getByText("已选择 2 / 2", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("output-files-light-zh.png"), fullPage: true });

  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { name: "Output files", exact: true })).toBeVisible();
  await expect(page.getByText("2 / 2 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete output", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export as ZIP", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("global model settings remain readable in both viewports", async ({ page }, testInfo) => {
  await page.goto("/model-settings");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cavwic-lab-locale", "zh");
    localStorage.setItem("cavwic-lab-theme", "light");
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "模型配置" })).toBeVisible();
  await expect(page.getByText("使用当前 Codex 套餐")).toBeVisible();
  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("heading", { name: "Model configuration" })).toBeVisible();
  await expect(page.locator(".settings-page-actions").getByRole("button")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("model-settings-codex-zh.png"), fullPage: true });
});
