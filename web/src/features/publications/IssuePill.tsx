import { IconAlertTriangle } from "@tabler/icons-react";
import { Button as AriaButton } from "react-aria-components";
import { Hint, StatusPill } from "@/components/ui";
import { registryText as t } from "./registryText";

// Problems are red when nothing can be ordered because of them, amber when
// somebody has to act or something is on its way out, neutral when the
// publication is simply not there yet.
const ISSUE_TONE: Record<string, string> = {
  chart_missing: "bg-red-50 text-red-700",
  gone: "bg-red-50 text-red-700",
  no_owner: "bg-amber-50 text-amber-700",
  not_orderable: "bg-amber-50 text-amber-700",
  deprecated: "bg-amber-50 text-amber-700",
  no_order_form: "bg-slate-100 text-slate-600",
};

// IssuePill names one problem of a publication (a server-side issue code) and
// explains it on hover or focus. A code this build does not know (a newer
// server) is shown as the code: better than a problem the page silently drops.
export function IssuePill({ code }: { code: string }) {
  const known = (t.issue as Record<string, { label: string; hint: string }>)[code];
  const tone = ISSUE_TONE[code] ?? "bg-slate-100 text-slate-600";
  const pill = (
    <StatusPill tone={tone} Icon={IconAlertTriangle}>
      {known?.label ?? code}
    </StatusPill>
  );
  if (!known) return pill;
  return (
    <Hint text={known.hint}>
      <AriaButton className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{pill}</AriaButton>
    </Hint>
  );
}
