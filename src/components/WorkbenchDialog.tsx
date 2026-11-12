import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import "../styles/workbench-dialog.css";

export default function WorkbenchDialog({ open, title, closeLabel, onClose, busy = false, testId, headerClassName = "", children }: {
  open: boolean; title: string; closeLabel: string; onClose(): void; busy?: boolean;
  testId: string; headerClassName?: string; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const lastDialogFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      previousFocus.current?.focus({ preventScroll: true });
    }
    return () => { if (element.open) { element.close(); previousFocus.current?.focus({ preventScroll: true }); } };
  }, [open]);
  useEffect(() => {
    if (!open || busy) return;
    const frame = requestAnimationFrame(() => {
      const element = dialog.current, active = document.activeElement;
      if (!element?.open || element.contains(active) || active?.closest("dialog")) return;
      const previous = lastDialogFocus.current;
      const target = previous && element.contains(previous) && !previous.matches(":disabled")
        ? previous : element.querySelector<HTMLButtonElement>(".workbench-dialog-header > button");
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, busy]);
  return <dialog ref={dialog} className="workbench-dialog" data-testid={testId} aria-labelledby={titleId} aria-busy={busy}
    onFocusCapture={event => { if (event.target instanceof HTMLElement) lastDialogFocus.current = event.target; }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className={`workbench-dialog-header ${headerClassName}`}><h2 id={titleId}>{title}</h2><button type="button" className="row-delete" aria-label={closeLabel} title={closeLabel} disabled={busy} onClick={onClose}><X size={20}/></button></header>
    <div className="workbench-dialog-body">{children}</div>
  </dialog>;
}
