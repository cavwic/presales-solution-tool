import { describe, expect, it } from "vitest";
import type { PresalesRoundAction } from "./workspace-schema";
import { analysisSupplementText, presalesRoundDirectory, responseFileMetadata, safeWorkspaceName } from "./workspace-storage";

describe("workspace storage rules", () => {
  it("builds stable Chinese module and communication folder names", () => {
    expect(presalesRoundDirectory(0)).toBe("1_售前准备/2_客户沟通与文件响应/第一轮沟通");
    expect(presalesRoundDirectory(11)).toBe("1_售前准备/2_客户沟通与文件响应/第十二轮沟通");
    expect(safeWorkspaceName('技术标:总体/方案')).toBe("技术标-总体-方案");
  });

  it("omits empty analysis supplements and records response metadata", () => {
    expect(analysisSupplementText([], "")).toEqual([]);
    expect(analysisSupplementText(["技术参数"], "保留来源").map((item) => item.name)).toEqual(["关键词.txt", "分析要求.txt"]);
    const action: PresalesRoundAction = {
      id: "action-1",
      title: "",
      owner: "方案负责人",
      dueDate: "2026-09-01",
      status: "open",
      responseFileName: "技术响应",
      responseFileFormat: "docx",
      fileRequirements: "使用正式模板",
      templateSourceIds: [],
      selectedTemplateSourceIds: [],
    };
    expect(responseFileMetadata(action, "技术响应.docx")).toContain("项目负责人：方案负责人");
  });
});
