import { IconArrowRight, IconClock, IconUser } from "@tabler/icons-react";
import { useState } from "react";
import { api, errorMessage } from "@/api/client";
import type { ChartPublication, Submission } from "@/api/types";
import { useCatalog } from "@/app/CatalogContext";
import { useToast } from "@/app/ToastContext";
import { useTeamLabel } from "@/auth/UserContext";
import { FormErrors } from "@/components/FormErrors";
import { Button } from "@/components/ui";
import { adminPublicationText } from "./adminPublicationText";
import { registryText as t } from "./registryText";

// The decision on a publication's category and owner: what a team proposed,
// who sent it, and the admin's verdict. The registry page opens it in a side
// panel, the publication page draws it in place. Both run the same decision,
// through the hook below, so a comment is required to reject in both.

// Change is "was > will be" for one proposed value. The old value is muted,
// not struck: a strike in a light colour reads as a tear through the text.
export function Change({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-slate-400">{from}</span>
      <IconArrowRight size={12} className="text-slate-400" aria-hidden />
      <span className="font-medium text-slate-700">{to}</span>
    </span>
  );
}

export function useMetaDecision(pub: ChartPublication | null, onDecided: () => void) {
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    if (!pub) return;
    if (action === "reject" && comment.trim() === "") {
      setErr(t.commentRequired);
      return;
    }
    setBusy(action);
    setErr(null);
    try {
      if (action === "approve") {
        await api.approvePublication(pub.id);
        toast.success(t.approved);
      } else {
        await api.rejectPublication(pub.id, comment.trim());
        toast.success(t.rejected);
      }
      setComment("");
      onDecided();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const onComment = (v: string) => {
    setComment(v);
    if (err) setErr(null);
  };
  return { comment, onComment, busy, err, decide };
}

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ProposalDiff lists the proposed values against the live ones.
export function ProposalDiff({ pub }: { pub: ChartPublication }) {
  const { categories } = useCatalog();
  const teamLabel = useTeamLabel();
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  if (!pub.draft_category_id && !pub.draft_owner_team) {
    return <p className="px-4 py-3 text-sm text-slate-500">{t.panelNoChanges}</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      {pub.draft_category_id && (
        <>
          <dt className="text-xs uppercase tracking-wide text-slate-400">{t.panelCategory}</dt>
          <dd>
            <Change from={catLabel(pub.category_id)} to={catLabel(pub.draft_category_id)} />
          </dd>
        </>
      )}
      {pub.draft_owner_team && (
        <>
          <dt className="text-xs uppercase tracking-wide text-slate-400">{t.panelOwner}</dt>
          <dd>
            <Change from={teamLabel(pub.owner_team)} to={teamLabel(pub.draft_owner_team)} />
          </dd>
        </>
      )}
    </dl>
  );
}

// SubmittedBy is the line under the diff: who sent the proposal and when.
export function SubmittedBy({ submitted }: { submitted?: Submission }) {
  if (!submitted) return null;
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <IconUser size={13} stroke={1.8} className="text-slate-400" aria-hidden />
        {submitted.by_name}
      </span>
      <span className="inline-flex items-center gap-1">
        <IconClock size={13} stroke={1.8} className="text-slate-400" aria-hidden />
        {fullDate(submitted.at)}
      </span>
    </>
  );
}

export function CommentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-slate-600">{t.commentLabel}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={t.commentPlaceholder}
        className="rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}

// MetaDecisionCard is the decision drawn in place on the publication page:
// the proposal, its sender, the comment and the two verdicts.
export function MetaDecisionCard({
  pub,
  submitted,
  onDecided,
}: {
  pub: ChartPublication;
  submitted?: Submission;
  onDecided: () => void;
}) {
  const d = useMetaDecision(pub, onDecided);
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <IconClock size={15} stroke={1.8} className="text-amber-500" aria-hidden />
        {adminPublicationText.decisionTitle}
      </h2>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-surface">
        <ProposalDiff pub={pub} />
        {submitted && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
            <SubmittedBy submitted={submitted} />
          </div>
        )}
      </div>
      <CommentField value={d.comment} onChange={d.onComment} />
      {d.err && <FormErrors message={d.err} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="danger" isDisabled={d.busy !== null} onPress={() => d.decide("reject")}>
          {t.reject}
        </Button>
        <Button variant="primary" isDisabled={d.busy !== null} onPress={() => d.decide("approve")}>
          {t.approve}
        </Button>
      </div>
    </section>
  );
}

// MetaDraftNotice shows a team's change that has not been sent yet: nothing
// to decide, but the admin sees what is coming.
export function MetaDraftNotice({ pub }: { pub: ChartPublication }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">{adminPublicationText.draftTitle}</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <ProposalDiff pub={pub} />
      </div>
      <p className="text-sm text-slate-500">{adminPublicationText.draftHint}</p>
    </section>
  );
}
