import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";

// FormDialogShell is the shared chrome of the dialogs that edit an order,
// styled as a full-height slide-over panel on the right (console pattern for
// editing list entries): blurred backdrop, icon-tile header with a
// title/subtitle pair, a scrollable body and a tinted footer pinned to the
// bottom.
export function FormDialogShell({
  isOpen,
  onClose,
  icon,
  title,
  subtitle,
  maxWidth = "max-w-xl",
  footer,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  footer: (close: () => void) => ReactNode;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      // scrim, not a slate tint: the neutral ramp is inverted in the dark
      // themes, so slate-900 there is nearly white and the dimming became a
      // bright veil. scrim is plain black and dims harder on a black page.
      className="scrim fixed inset-0 z-50 backdrop-blur-[2px] entering:animate-in entering:fade-in entering:duration-200 exiting:animate-out exiting:fade-out exiting:duration-200 exiting:fill-mode-forwards"
    >
      <Modal
        className={`fixed inset-y-0 right-0 w-full ${maxWidth} border-l border-slate-200 bg-surface shadow-2xl outline-none entering:animate-in entering:slide-in-from-right entering:duration-300 entering:ease-out exiting:animate-out exiting:slide-out-to-right exiting:duration-200 exiting:fill-mode-forwards`}
      >
        <Dialog className="flex h-full flex-col outline-none">
          {({ close }) => (
            <>
              <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold text-slate-800">{title}</h2>
                  {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Закрыть"
                  className="rounded-md p-1.5 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
              <footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
                {footer(close)}
              </footer>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
