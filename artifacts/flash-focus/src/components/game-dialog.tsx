import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let openDialogs = 0;

function focusables(node: HTMLElement | null) {
  if (!node) return [];
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => !item.hasAttribute("inert") && item.offsetParent !== null);
}

/**
 * Accessible modal: portals outside #root, makes the app inert, traps Tab,
 * handles Escape and restores focus to the trigger on close.
 */
export function GameDialog({
  labelledBy,
  describedBy,
  onEscape,
  initialFocusRef,
  className = "modal",
  testId,
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  onEscape?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    openDialogs += 1;
    root?.setAttribute("inert", "");
    const panel = panelRef.current;
    const target = initialFocusRef?.current ?? focusables(panel)[0] ?? panel;
    target?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusables(panel);
      if (!items.length) { event.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !panel.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      openDialogs = Math.max(0, openDialogs - 1);
      if (!openDialogs) root?.removeAttribute("inert");
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // Mount-only: focus management must not re-run on parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="overlay">
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-testid={testId}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
