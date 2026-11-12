# Selected workspace design

The user chose A / Linear on 2026-11-11 after reviewing four working alternatives. The production workspace adopts that reference's composition and restraint, while retaining the application's real workflow and local desktop behavior.

## Composition

- A two-row native app shell: brand and history, then model modes and shared Skills. Language, theme, minimize, maximize/restore and close remain at the upper right.
- A 228px project sidebar with search, five lifecycle stages, real project materials, and project operations at the bottom.
- A flexible central document with a compact breadcrumb, context actions, editable project title and the current lifecycle stage's existing content.
- A 278px inspector for editable project properties, requirement coverage, real action items, blocking issues and current stage. These are functional data views, not decorative metrics.
- Below 1000px, the inspector follows the document. At 760px and below, the stage navigation becomes horizontal and the project operations remain available. Business editors respond to their actual container width.

## Color and type

Light surfaces: #ffffff and #f6f8fb, text #202c3b, secondary #5c6a7b, separators #e0e5ec, blue #2864bd. Dark surfaces: #191f28 and #11151b, text #e3e9f2, secondary #a5b1c3, separators #354052, blue #a8caff.

Use the bundled Manrope face for Latin text, with Microsoft YaHei UI / PingFang SC fallback for Chinese. Body and main fields are 16px; compact navigation and properties use 13–15px; document titles use 28–30px. Preserve comfort at display scaling instead of shrinking an entire page.

## Controls and behavior

Quiet document editing surfaces reveal their borders on hover and focus. Existing confirmation, error, import, generation and cleanup states remain intact. Blue indicates the active stage, focus and primary actions. Use fine separators, low-radius controls and no decorative gradients. Text selection, caret, scrollbar and focus ring use the shared palette. Respect reduced motion.

The frameless window has a small page-colored outer edge and bottom transition. All visible text can be selected or copied through the existing context menu. The real data profile, authorized project folders, model configuration and storage keys stay unchanged.

The native topbar stays at the viewport top. Opening model settings resets only the settings panel's own scroll position; it must never scroll the document or any outer app container. Settings content may scroll independently while the language, theme, window and collapse controls remain reachable.

All fixed workspace frames use non-scrolling clipping. Only the central document, inspector, sidebar middle section, and narrow content pane own scroll positions. Anchor navigation calculates coordinates inside the active content pane instead of invoking whole-ancestor scrolling. Sidebar project identity/search and footer stay outside its middle scroll region. The title wraps and grows with the text. At viewport heights of 760px or less, expanded model settings take the working area; collapsing them restores the workspace. Keep just the communication section's plus action, without a duplicate in the view toolbar.

## Preservation

Project settings, named project creation and history use independent modal dialogs with fixed headers, explicit close buttons and scrollable bodies. Escape returns to the invoking control. History offers search, submitted-state filtering, manual submission marks, folder access, loading and adding existing workspaces.

The project library lives beside the tool's launcher outside managed release folders. Each project has a stable directory, stage folders and a project record; a human-readable CSV index and per-project note support manual lookup. New/load operations preserve the current snapshot before switching all project, file and directory state together. Changing a folder copies files without deleting the original, and refuses a target containing another project's record. File mirroring is incremental, and pending/uncommitted snapshots are absent from the history list.

The pre-change Blueprint design is retained as a separately runnable original version. Its source/build archive and profile snapshot are private local artifacts under `preserved/`; its runtime is separate from the fixed current installation. No preview demo data is written into the production profile.
