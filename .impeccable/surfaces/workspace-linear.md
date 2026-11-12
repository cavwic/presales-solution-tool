# Production Linear workspace

Mode: Operate.
Primary target: src/components/SolutionWorkbench.tsx.
Related targets: src/layouts/BaseLayout.astro, src/styles/workspace-linear.css.

User decision: 2026-11-11, adopt option A from the four interactive design studies. This is a code-led integration of the approved layout, not an open concept selection. Public references are docs/images/workbench.en.png and docs/images/workbench.zh.png.

Use the compact project sidebar, central editable document, and right-hand property inspector. Keep the existing real workflow components and handlers, project and model persistence, Skills, cleanup safeguards, undo/redo and native controls. Show real action items and coverage instead of the preview's fictional checklist. On narrow windows move the inspector below the document; simplify the left navigation without shrinking body text.

The maintainer's original build and independent data snapshot are private local artifacts and are not distributed. Update desktop shortcuts only after the packaged app passes validation. The user authorized publishing the current version to GitHub on 2026-11-12.

Project settings and project history now use dedicated modal surfaces rather than inline workbench sections. History is factual saved data, with user-marked submission state and explicit missing-file messages. Store project materials in the visible tool-root project library, preserve external originals, and prevent cross-project directory writes. A named new project is a separate working folder; saving or switching must not discard the previous project's sole file copies.
