import { IconCopy, IconRestore } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/api/client";
import { qk } from "@/api/queryKeys";
import type { OrderRequest, Stand } from "@/api/types";
import { findCatalogChart, useCatalog } from "@/app/CatalogContext";
import { FormDialogShell } from "@/components/FormDialogShell";
import { Button, ErrorBox, Select, TextField } from "@/components/ui";
import { fieldKind } from "@/form/fieldErrors";
import { namespaceKind, parseNamespaceDirective } from "@/form/namespace";
import { useAsync } from "@/hooks/useAsync";
import { copyText as t } from "./copyText";

// Copying an order: a panel that asks where the copy goes (the stand, its
// cluster, the name and, where the form has one, the namespace) and makes a
// draft there. It opens on the order's own stand, for "one more like this":
// there the name has to be new, so it starts empty. Another stand is a copy of
// the same thing, and the original's name comes back. The person reviews the
// draft on the order form afterwards, so nothing else is asked here.
//
// The portal decides the rest of the copy itself (see provisioning.Copy):
// what was derived from the name follows the new name, a version no longer on
// offer is replaced by the latest one.
export function CopyOrderDialog({
  order,
  onClose,
  onCopied,
}: {
  // The order to copy; null keeps the panel closed.
  order: OrderRequest | null;
  onClose: () => void;
  onCopied: (draft: OrderRequest, stand: Stand | undefined) => void;
}) {
  const { data: stands } = useAsync((signal) => api.listStands(signal), [], qk.stands());
  const { charts } = useCatalog();
  // The order's view says whether the order form has a namespace input at all:
  // a chart that takes it from its values or a constant ignores what is typed.
  const { data: view } = useAsync(
    (signal) => (order ? api.getRequestView(order.id, signal).catch(() => null) : Promise.resolve(null)),
    [order?.id],
  );
  const [standId, setStandId] = useState("");
  const [cluster, setCluster] = useState("");
  const [name, setName] = useState("");
  // null while the namespace follows the name (or the original's): the
  // person has not typed one.
  const [namespace, setNamespace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A deleted order is restored by the same copy: it no longer holds its name,
  // so the copy takes it back in its place. A stand deleted since is not
  // offered, and the panel opens on the default one instead.
  const restoring = order?.status === "DELETED";
  const standGone = restoring && !!stands && !stands.some((s) => s.id === order?.stand_id);

  useEffect(() => {
    if (!order || !stands?.length) return;
    const own = stands.find((s) => s.id === order.stand_id);
    const pick = own ?? stands.find((s) => s.default) ?? stands[0];
    setStandId(pick.id);
    setCluster(own ? order.cluster : pick.default_cluster);
    setName(own && order.status !== "DELETED" ? "" : order.service_name);
    setNamespace(null);
    setErr(null);
    setBusy(false);
  }, [order, stands]);

  const sameStand = !!order && standId === order.stand_id;
  // Next to the live original the name has to be a new one.
  const beside = sameStand && !restoring;

  function pickStand(id: string) {
    if (!order) return;
    setStandId(id);
    if (id === order.stand_id) {
      setCluster(order.cluster);
      if (!restoring && name === order.service_name) setName("");
      return;
    }
    const st = stands?.find((s) => s.id === id);
    if (st) setCluster(st.default_cluster);
    if (!name.trim()) setName(order.service_name);
  }

  const nsField = useMemo(
    () =>
      parseNamespaceDirective((view?.views?.order as { namespace?: unknown } | undefined)?.namespace)
        .source === "field",
    [view],
  );
  // What the namespace is when nobody typed one: the new name, when the
  // original's was its name, else the original's.
  const nsFollowsName = !!order && order.namespace === order.service_name;
  const shownNamespace = namespace ?? (nsFollowsName ? name : (order?.namespace ?? ""));

  // The original's version is no longer on offer: the copy takes the latest
  // one that is, and the person hears it before the draft is made.
  const pub = order ? findCatalogChart(charts, order.chart_project, order.chart_name)?.publication : undefined;
  const orderable = pub?.orderable_versions ?? [];
  const newVersion =
    order && orderable.length > 0 && !orderable.includes(order.chart_version) ? orderable[0] : "";

  async function submit() {
    if (!order || !standId) return;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.copyRequest(order.id, {
        stand_id: standId,
        cluster: cluster.trim(),
        service_name: name.trim(),
        namespace: nsField ? shownNamespace.trim() : undefined,
      });
      onCopied(
        draft,
        stands?.find((s) => s.id === standId),
      );
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  const options = (stands ?? []).map((s) => ({ id: s.id, label: s.name }));

  return (
    <FormDialogShell
      isOpen={order !== null}
      onClose={onClose}
      icon={restoring ? <IconRestore size={20} stroke={1.8} /> : <IconCopy size={20} stroke={1.8} />}
      title={restoring ? t.restoreTitle : t.dialogTitle}
      subtitle={order ? order.display_name || order.service_name : undefined}
      footer={(close) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={close} isDisabled={busy}>
            Отмена
          </Button>
          <Button variant="primary" onPress={submit} isDisabled={busy || !standId || !name.trim()}>
            {busy ? t.busy : t.submit}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">{restoring ? t.restoreIntro : t.dialogIntro}</p>
        {restoring && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {t.restoreDataNote}
            {standGone && ` ${t.restoreStandGone}`}
          </div>
        )}
        {newVersion && order && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {t.versionNote(order.chart_version, newVersion)}
          </div>
        )}
        {err && <ErrorBox error={new Error(err)} />}
        <Select
          label={t.standLabel}
          description={t.standDescription}
          isRequired
          selectedKey={standId || null}
          onSelectionChange={pickStand}
          options={options}
        />
        <TextField
          label={t.clusterLabel}
          description={sameStand ? t.clusterSameStand : t.clusterOtherStand}
          kind={fieldKind.dnsLabel()}
          value={cluster}
          onChange={setCluster}
        />
        <TextField
          label={t.nameLabel}
          description={beside ? t.nameSameStand : restoring ? t.restoreName : t.nameOtherStand}
          isRequired
          kind={fieldKind.dnsLabel()}
          value={name}
          onChange={setName}
        />
        {nsField && (
          <TextField
            label={t.namespaceLabel}
            description={nsFollowsName ? t.namespaceFollowsName : t.namespaceKept}
            kind={namespaceKind}
            value={shownNamespace}
            onChange={setNamespace}
          />
        )}
      </div>
    </FormDialogShell>
  );
}
