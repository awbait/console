import { IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/api/client";
import { qk } from "@/api/queryKeys";
import type { OrderRequest, Stand } from "@/api/types";
import { FormDialogShell } from "@/components/FormDialogShell";
import { Button, ErrorBox, Select, TextField } from "@/components/ui";
import { fieldKind } from "@/form/fieldErrors";
import { useAsync } from "@/hooks/useAsync";
import { copyText as t } from "./copyText";

// Copying an order to another stand: a panel that asks where the copy goes
// (the stand, its cluster, the name) and makes a draft there. The person
// reviews the draft on the order form afterwards, so nothing else is asked
// here.
export function CopyToStandDialog({
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
  const [standId, setStandId] = useState("");
  const [cluster, setCluster] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Open on another stand than the order's: that is what a copy is for. The
  // default stand when it is another one, else the first that is.
  useEffect(() => {
    if (!order || !stands?.length) return;
    const other = stands.filter((s) => s.id !== order.stand_id);
    const pick = other.find((s) => s.default) ?? other[0] ?? stands[0];
    setStandId(pick.id);
    setCluster(pick.default_cluster);
    setName(order.service_name);
    setErr(null);
    setBusy(false);
  }, [order, stands]);

  function pickStand(id: string) {
    setStandId(id);
    const st = stands?.find((s) => s.id === id);
    if (st) setCluster(st.default_cluster);
  }

  async function submit() {
    if (!order || !standId) return;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.copyRequest(order.id, {
        stand_id: standId,
        cluster: cluster.trim(),
        service_name: name.trim(),
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
      icon={<IconCopy size={20} stroke={1.8} />}
      title={t.dialogTitle}
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
        <p className="text-sm text-slate-600">{t.dialogIntro}</p>
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
          label="Кластер"
          description={t.clusterDescription}
          kind={fieldKind.dnsLabel()}
          value={cluster}
          onChange={setCluster}
        />
        <TextField
          label={t.nameLabel}
          description={t.nameDescription}
          kind={fieldKind.dnsLabel()}
          value={name}
          onChange={setName}
        />
      </div>
    </FormDialogShell>
  );
}
