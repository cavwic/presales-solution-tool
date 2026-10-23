# Workspace contract

```text
solution-workspace/
  workspace.json
  0_项目客户方资料/
  1_售前准备/
    2_客户沟通与文件响应/<轮次>/
      客户附件/
      参考文件/
      需求分析/
      生成文件/
  2_招标要求/
    1_招标文件/导入文件/
    2_澄清及相关文件/<轮次>/导入文件/
    3_招标文件分析/
  3_技术标组包/1_投标文件输出/
  4_中标交底/
  5_输出文件/
  library/
    library.json
    approved company materials
  projects/<project-id>/
    project.json
    sources/
    work/
      requirements.csv
      solution-draft.md
      presentation.md
    templates/
    outputs/
```

The numbered folders are the user-facing business record. `library/` and `projects/` contain internal metadata and regenerated working files.

`workspace.json` identifies the active project. `project.json` is the canonical structured record. Each source's `workspacePath` is its canonical physical location. Read that path first; use `projects/<project-id>/sources/` only for legacy sources whose `workspacePath` is empty.

Store imported files under the applicable module's `导入文件`, `客户附件`, `参考文件`, or template subfolder. Store model outputs under `生成文件` or the module's analysis folder, together with non-empty keywords, analysis instructions, file requirements, owner, due date, and status records. A template supplies formatting only and must never supply generated content.

Before copying a file, compare its SHA-256 with project sources. If the same file already exists in the project, keep the original canonical file and write `说明文档.txt` in the consuming folder with its name, canonical path, and SHA-256. Do not create a duplicate copy.

Each requirement contains at least: identifier, baseline, category, original wording, normalized wording, source reference, mandatory/scored flags, owner, response status, deviation type, formal response, evidence identifiers, review state, acceptance criteria, and notes.

Allowed response status values:

- `confirmed`: current evidence establishes the response.
- `conditional`: the response depends on an explicit condition or configuration.
- `custom`: development, integration, or non-standard work is required.
- `missing_evidence`: evidence is absent or stale.
- `unsupported`: the available solution cannot meet the requirement.

Only human review may set `reviewState` to `approved`. `confirmed` requires at least one evidence reference. `unsupported` requires a negative deviation. Conditional or custom responses must not be silently represented as no deviation.
