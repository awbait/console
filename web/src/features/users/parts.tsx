import { IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button as AriaButton, Dialog, Modal, ModalOverlay, Tab } from "react-aria-components";
import type { PlatformUser } from "@/api/types";
import { Chip } from "@/components/ui";
import { initials, personName } from "./text";

// The small pieces every view of a person is built from. They live here because
// the page, the person's card and the team's card all show the same person and
// must show them the same way.

export const ROLE_LABEL: Record<string, string> = {
  admin: "Администратор платформы",
  support: "Поддержка",
  security: "Информационная безопасность",
  member: "Участник команды",
  auditor: "Наблюдатель",
};

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 text-base" : "h-8 w-8 text-xs";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ${box}`}
    >
      {initials(name)}
    </span>
  );
}

export function TeamChips({ teams }: { teams: string[] }) {
  if (teams.length === 0) return <span className="text-slate-400">без команды</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {teams.map((t) => (
        <Chip key={t} className="bg-slate-100 text-slate-600">
          {t}
        </Chip>
      ))}
    </span>
  );
}

export function OnlinePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      в сети
    </span>
  );
}

// displayName is what to print for a person anywhere on these screens.
export function displayName(p: PlatformUser): string {
  return personName(p.name, p.subject);
}

// CardSheet is the dialog a person and a team both open in: a header that stays
// put and a body that scrolls. Wide, because what is inside is a table of what
// somebody did, and a narrow column turns every line into three.
export function CardSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-10 flex items-start justify-center scrim p-4 pt-16 entering:animate-in entering:fade-in"
    >
      <Modal className="w-full max-w-3xl rounded-lg border border-slate-200 bg-surface shadow-xl">
        <Dialog className="outline-none">
          <div className="flex max-h-[80vh] flex-col">{children}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

// CloseButton is the dialog's own way out, beside the Esc key and the backdrop.
export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <AriaButton
      aria-label="Закрыть"
      onPress={onPress}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <IconX size={16} stroke={1.8} />
    </AriaButton>
  );
}

// CardTab is the portal's tab shape, kept here so the users screens do not
// reach into the publication editor for it.
export function CardTab({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Tab
      id={id}
      className="-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 outline-none transition-colors hover:text-gray-700 selected:border-brand-600 selected:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {children}
    </Tab>
  );
}

// Fact is one labelled value in a card's header block.
export function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800" title={title}>
        {value}
      </dd>
    </div>
  );
}
