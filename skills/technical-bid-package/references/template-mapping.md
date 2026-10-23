# PPTX template mapping

The renderer opens a standard `.pptx`, removes all ordinary template slides, and then adds generated slides using the remaining layouts and masters. Logos and design elements placed on the master normally remain. Template slide text, examples, claims, figures, speaker notes, and instructions are never drafting sources and must not appear in generated content.

Apply the same boundary to other formats. DOCX templates may contribute supported styles, page setup, headers, footers, numbering, borders, and shading. XLSX templates may contribute supported row heights, column widths, wrapping, alignment, number formats, borders, fills, and print settings. Clear template body paragraphs and cell values before writing generated content.

Use this sequence:

```powershell
python scripts/render_pptx.py --inspect-template templates/company-template.pptx
python scripts/render_pptx.py --template templates/company-template.pptx --plan work/presentation-plan.json --map templates/template-map.json --output outputs/customer-presentation.pptx
```

`template-map.json` maps semantic roles to layout names and optional placeholder indexes. Use layout names reported by `--inspect-template`.

The renderer supports title, section, content, comparison, and closing roles. If a mapped layout or placeholder is absent, it falls back to available title/body placeholders and reports a warning.

Unsupported fidelity includes VBA macros, complex animations, linked OLE objects, custom add-ins, unsupported media, and fonts that are not installed on the rendering machine.
