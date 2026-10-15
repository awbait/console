import { IconDeviceFloppy } from "@tabler/icons-react";
import { Button } from "../../components/ui";
import { fmtDateTime } from "../../lib/time";
import { maintenanceText as t } from "./text";

// RestoreNotice offers back a form the portal put in the browser when
// maintenance locked it. Both ways out are explicit: restoring writes over what
// the form opened with, and refusing throws the copy away for good.
export function RestoreNotice({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-slate-700"
    >
      <IconDeviceFloppy size={20} stroke={1.8} className="mt-0.5 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">{t.restoreTitle}</p>
        <p className="mt-1">{t.restoreText(fmtDateTime(savedAt))}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onPress={onRestore}>
            {t.restoreAction}
          </Button>
          <Button variant="secondary" onPress={onDiscard}>
            {t.discardAction}
          </Button>
        </div>
      </div>
    </div>
  );
}
