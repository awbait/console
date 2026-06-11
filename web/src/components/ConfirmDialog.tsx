import { useEffect, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { HttpError } from "../api/client";

interface ConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  // Label shown on the confirm button while the action is in flight.
  busyLabel?: string;
  cancelLabel?: string;
  // Style the confirm button as a destructive action (red).
  danger?: boolean;
  // Runs on confirm. If it throws, the error is shown inside the dialog and the
  // dialog stays open; on success the dialog closes.
  onConfirm: () => void | Promise<void>;
}

// ConfirmDialog is a reusable replacement for window.confirm(): a centered modal
// with a confirm/cancel pair that awaits an async action, shows a busy state and
// surfaces errors inline instead of via alert().
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  message,
  confirmLabel = "Подтвердить",
  busyLabel = "Подождите…",
  cancelLabel = "Отмена",
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset transient state whenever the dialog (re)opens.
  useEffect(() => {
    if (isOpen) {
      setBusy(false);
      setErr(null);
    }
  }, [isOpen]);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!busy}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 entering:animate-in entering:fade-in"
    >
      <Modal className="w-full max-w-md rounded-lg bg-surface shadow-xl outline-none entering:animate-in entering:zoom-in-95">
        <Dialog role="alertdialog" className="outline-none">
          {({ close }) => (
            <div className="flex flex-col">
              <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
                <div className="flex items-start gap-3">
                  {danger && (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                      <IconAlertTriangle size={20} stroke={1.8} />
                    </span>
                  )}
                  <h2 className="pt-1 text-base font-semibold text-gray-900">{title}</h2>
                </div>
                <button
                  onClick={close}
                  disabled={busy}
                  aria-label="Закрыть"
                  className="rounded-md p-1 text-gray-400 outline-none hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                >
                  <IconX size={18} stroke={2} />
                </button>
              </header>
              <div className={`px-4 pb-4 text-sm text-gray-600 ${danger ? "pl-16" : ""}`}>
                {message}
                {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
              </div>
              <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
                <button
                  onClick={close}
                  disabled={busy}
                  className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={confirm}
                  disabled={busy}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${
                    danger
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-brand-600 text-on-accent hover:bg-brand-700"
                  }`}
                >
                  {busy ? busyLabel : confirmLabel}
                </button>
              </footer>
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
