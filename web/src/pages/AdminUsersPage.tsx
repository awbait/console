import {
  IconExternalLink,
  IconRefresh,
  IconSettings,
  IconUser,
  IconUserCheck,
  IconUsers,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import {
  Button as AriaButton,
  Cell,
  Column,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import { api } from "@/api/client";
import type { ActivityEvent, PlatformUser, TeamActivity } from "@/api/types";
import { Button, buttonClass, Card, Chip, ErrorBox, SkeletonRows, TextField } from "@/components/ui";
import { ruPlural } from "@/form/fieldErrors";
import { useAsync } from "@/hooks/useAsync";
import { safeHref } from "@/lib/href";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { StatCard } from "./AdminSection";
import { actionText, initials, personName, seenAgo } from "./usersText";

// Who uses the portal. The admin has no other way of telling a portal three
// teams live in from one nobody has opened in a month.
//
// Names are here and numbers are in Grafana, and that split is deliberate: the
// portal knows who these people are because they signed in, the metrics port
// does not ask anyone to sign in, and trends over time are a thing dashboards
// already do better than a table would.

// How often "who is here now" re-asks. Presence is a five-minute window, so
// anything finer only adds requests; anything coarser and a name lingers after
// the person has gone.
const ONLINE_REFRESH_MS = 30_000;

// How many people the directory shows before the search box becomes the way
// through it. Enough to read a small company at a glance.
const DIRECTORY_ROWS = 25;

export function AdminUsersPage() {
  const { data, error, loading, reload } = useAsync((s) => api.getUsers(s), []);
  // The online half re-asks on its own. It is the only part of the page that
  // goes stale while somebody is reading it.
  const { data: live } = useAsync((s) => api.getOnline(s), [], undefined, {
    refetchInterval: ONLINE_REFRESH_MS,
  });
  const [query, setQuery] = useState("");
  // The team the reader has narrowed to, or "" for the whole platform. It
  // scopes both the directory and the feed, which is the point: "what has team
  // core been doing" is one question, not two.
  const [team, setTeam] = useState("");
  const [person, setPerson] = useState<PlatformUser | null>(null);

  // The feed for one team comes from its own request: narrowing it must not
  // re-read the directory and presence with it.
  const { data: teamFeed } = useAsync(
    (s) => (team ? api.getUserEvents({ team }, s) : Promise.resolve(null)),
    [team],
  );

  const online = live?.online ?? data?.online ?? [];
  // The directory is read once with the page, presence every thirty seconds.
  // Fold the fresher one into the older, or the same person reads as "только
  // что" in the online list and "5 мин назад" in the table below it.
  const users = useMemo(() => {
    const fresh = new Map(online.map((p) => [p.subject, p]));
    return (data?.users ?? []).map((u) => {
      const now = fresh.get(u.subject);
      return now ? { ...u, online: true, seen_ago: now.seen_ago, last_seen: now.last_seen } : u;
    });
  }, [data, online]);
  const inTeam = useMemo(
    () => (team ? users.filter((u) => u.teams.includes(team)) : users),
    [users, team],
  );
  const found = useMemo(() => matching(inTeam, query), [inTeam, query]);
  const events = team ? (teamFeed?.events ?? []) : (data?.events ?? []);

  const totals = data?.totals;
  const grafana = safeHref(data?.grafana_url);

  return (
    // The page stays within the viewport: the heading keeps its place and only
    // the sections below it scroll. Same shape as the rest of the admin section.
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Пользователи</h1>
          <Chip className="bg-brand-50 text-brand-700">
            <IconSettings size={13} stroke={1.8} className="text-brand-400" />
            Admin
          </Chip>
          {team && (
            <AriaButton
              onPress={() => setTeam("")}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 outline-none hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Команда {team}
              <IconX size={13} stroke={2} className="text-slate-400" />
            </AriaButton>
          )}
        </div>
        <div className="flex items-center gap-2">
          {grafana && (
            <a
              href={grafana}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary", "gap-1.5")}
            >
              Тренды в Grafana
              <IconExternalLink size={14} stroke={1.8} />
            </a>
          )}
          <Button variant="secondary" onPress={reload} className="gap-1.5">
            <IconRefresh size={16} stroke={1.8} className="text-slate-400" />
            Обновить
          </Button>
        </div>
      </div>

      {/* The scroll box: -mx-1/px-1 gives the cards' shadows and focus rings the
          room the clipping edge would otherwise cut off. */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-1 pb-1">
        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : (
          <>
            <section className="flex flex-col">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Сейчас в сети"
                  value={online.length}
                  tone="emerald"
                  Icon={IconUserCheck}
                />
                <StatCard
                  label="Заходили за сутки"
                  value={totals?.active_24h ?? 0}
                  tone="brand"
                  Icon={IconUser}
                />
                <StatCard
                  label="Заходили за неделю"
                  value={totals?.active_7d ?? 0}
                  tone="slate"
                  Icon={IconUsers}
                />
                <StatCard
                  label="Команд на платформе"
                  value={totals?.teams ?? 0}
                  tone="amber"
                  Icon={IconUsersGroup}
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Портал знает тех, кто хотя бы раз в него заходил. Человек считается в сети, если его
                браузер обращался к порталу за последние{" "}
                {Math.round((data?.online_window_seconds ?? 300) / 60)} мин. Список обновляется сам
                каждые {ONLINE_REFRESH_MS / 1000} сек.
              </p>
            </section>

            <OnlineSection people={online} onOpen={setPerson} />

            <TeamsSection teams={data?.teams ?? []} active={team} onPick={setTeam} />

            <section className="flex flex-col">
              <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-800">
                  Кто заходил <span className="font-normal text-slate-400">{inTeam.length}</span>
                </h2>
                <div className="w-full sm:w-72">
                  <TextField
                    label="Поиск по людям и командам"
                    hideLabel
                    value={query}
                    onChange={setQuery}
                    placeholder="Имя, почта или команда"
                  />
                </div>
              </div>
              <PeopleTable people={found} total={inTeam.length} onOpen={setPerson} />
            </section>

            <section className="flex flex-col">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">
                Последние действия
                {team && <span className="font-normal text-slate-400"> команды {team}</span>}
              </h2>
              <ActivityFeed events={events} empty={team ? `У команды ${team} пока нет действий.` : undefined} />
            </section>
          </>
        )}
      </div>

      {person && <UserCard person={person} onClose={() => setPerson(null)} />}
    </div>
  );
}

// matching filters the directory by name, login, mail or team. One box for all
// four: the reader is looking for a person, not choosing a field to search in.
function matching(people: PlatformUser[], query: string): PlatformUser[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter((p) =>
    [p.name, p.username, p.email, p.subject, ...p.teams].some((v) =>
      (v ?? "").toLowerCase().includes(q),
    ),
  );
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 text-base" : "h-8 w-8 text-xs";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700 ${box}`}
    >
      {initials(name)}
    </span>
  );
}

function Teams({ teams }: { teams: string[] }) {
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

function OnlineSection({
  people,
  onOpen,
}: {
  people: PlatformUser[];
  onOpen: (p: PlatformUser) => void;
}) {
  return (
    <section className="flex flex-col">
      <div className="mb-3 flex min-h-9 items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Сейчас в сети</h2>
        <span className="text-sm text-slate-400">{people.length}</span>
      </div>
      {people.length === 0 ? (
        <Card className="text-sm text-slate-500">
          Сейчас порталом никто не пользуется. Здесь появятся те, кто зайдёт.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <AriaButton
              key={p.subject}
              onPress={() => onOpen(p)}
              className="cursor-pointer rounded-lg border border-slate-200 bg-surface p-4 text-left shadow-sm outline-none transition-colors hover:border-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span className="flex items-center gap-3">
                <Avatar name={personName(p.name, p.subject)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {personName(p.name, p.subject)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="truncate">
                      {p.teams.length > 0 ? p.teams.join(", ") : "без команды"}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="shrink-0">{seenAgo(p.seen_ago)}</span>
                  </span>
                </span>
              </span>
            </AriaButton>
          ))}
        </div>
      )}
    </section>
  );
}

// TeamsSection: how big each team is and how much of it is around. A row
// narrows the whole page to that team, and the same row clears it again.
function TeamsSection({
  teams,
  active,
  onPick,
}: {
  teams: TeamActivity[];
  active: string;
  onPick: (team: string) => void;
}) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Команды</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
        <Table aria-label="Команды платформы" className="w-full min-w-[32rem] text-sm">
          <TableHeader className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
            <Column isRowHeader className="px-4 py-2.5 text-left">
              Команда
            </Column>
            <Column className="px-4 py-2.5 text-right">Людей</Column>
            <Column className="px-4 py-2.5 text-right">В сети</Column>
            <Column className="px-4 py-2.5 text-right">За сутки</Column>
          </TableHeader>
          <TableBody
            renderEmptyState={() => (
              <div className="px-4 py-12 text-center text-sm text-slate-500">
                Пока не заходил никто из команд. Команда появляется здесь после первого входа её
                участника.
              </div>
            )}
          >
            {teams.map((t) => (
              <Row
                key={t.team}
                onAction={() => onPick(t.team === active ? "" : t.team)}
                className={`cursor-pointer border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 ${
                  t.team === active ? "bg-brand-50" : ""
                }`}
              >
                <Cell className="px-4 py-3 text-left font-medium text-slate-800">{t.team}</Cell>
                <Cell className="px-4 py-3 text-right text-slate-600">{t.members}</Cell>
                <Cell className="px-4 py-3 text-right text-slate-600">
                  {t.online > 0 ? (
                    <span className="font-medium text-emerald-600">{t.online}</span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </Cell>
                <Cell className="px-4 py-3 text-right text-slate-600">{t.active_24h}</Cell>
              </Row>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Администратор платформы",
  support: "Поддержка",
  security: "Информационная безопасность",
  member: "Участник команды",
  auditor: "Наблюдатель",
};

function PeopleTable({
  people,
  total,
  onOpen,
}: {
  people: PlatformUser[];
  total: number;
  onOpen: (p: PlatformUser) => void;
}) {
  const shown = people.slice(0, DIRECTORY_ROWS);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
      <Table aria-label="Кто заходил в портал" className="w-full min-w-[48rem] text-sm">
        <TableHeader className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Column isRowHeader className="px-4 py-2.5 text-left">
            Человек
          </Column>
          <Column className="px-4 py-2.5 text-left">Команды</Column>
          <Column className="px-4 py-2.5 text-left">Роль</Column>
          <Column className="px-4 py-2.5 text-left">Был на портале</Column>
          <Column className="px-4 py-2.5 text-right">Заходов</Column>
        </TableHeader>
        <TableBody
          renderEmptyState={() => (
            <div className="px-4 py-12 text-center text-sm text-slate-500">
              {total === 0
                ? "Пока в портал никто не заходил."
                : "Никого не нашли. Попробуйте другое имя или команду."}
            </div>
          )}
        >
          {shown.map((p) => (
            <Row
              key={p.subject}
              onAction={() => onOpen(p)}
              className="cursor-pointer border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50"
            >
              <Cell className="px-4 py-3 text-left">
                <span className="flex items-center gap-3">
                  <Avatar name={personName(p.name, p.subject)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-800">
                        {personName(p.name, p.subject)}
                      </span>
                      {p.online && <OnlinePill />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {p.email || p.username || p.subject}
                    </span>
                  </span>
                </span>
              </Cell>
              <Cell className="px-4 py-3 text-left">
                <Teams teams={p.teams} />
              </Cell>
              <Cell className="px-4 py-3 text-left text-slate-600">
                {ROLE_LABEL[p.role] ?? p.role}
              </Cell>
              <Cell className="px-4 py-3 text-left text-slate-600">
                {/* For somebody who is here, presence is the answer, worded the
                    same way the card above words it. */}
                <span title={fmtDateTime(p.last_seen)}>
                  {p.online ? seenAgo(p.seen_ago) : fmtRecent(p.last_seen)}
                </span>
              </Cell>
              <Cell className="px-4 py-3 text-right text-slate-500">{p.visits}</Cell>
            </Row>
          ))}
        </TableBody>
      </Table>
      {people.length > shown.length && (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Показали {shown.length} из {people.length}. Уточните поиск, чтобы найти нужного человека.
        </p>
      )}
    </div>
  );
}

function OnlinePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
      в сети
    </span>
  );
}

// UserCard: one person, opened from anywhere their name is on this page. Their
// own actions are fetched here rather than filtered out of the page's feed: the
// feed is the last few dozen events on the whole platform, and a person who has
// not acted today would come back empty from it.
function UserCard({ person, onClose }: { person: PlatformUser; onClose: () => void }) {
  const { data, error, loading } = useAsync(
    (s) => api.getUserEvents({ actor: person.subject }, s),
    [person.subject],
  );
  const name = personName(person.name, person.subject);
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-10 flex items-start justify-center scrim p-4 pt-24 entering:animate-in entering:fade-in"
    >
      <Modal className="w-full max-w-lg rounded-lg border border-slate-200 bg-surface shadow-xl">
        <Dialog className="outline-none">
          <div className="flex max-h-[70vh] flex-col">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <Avatar name={name} size="lg" />
              <div className="min-w-0 flex-1">
                <Heading
                  slot="title"
                  className="flex items-center gap-2 text-base font-semibold text-slate-800"
                >
                  <span className="truncate">{name}</span>
                  {person.online && <OnlinePill />}
                </Heading>
                <p className="mt-0.5 truncate text-sm text-slate-500">
                  {person.email || person.username || person.subject}
                </p>
                <div className="mt-2">
                  <Teams teams={person.teams} />
                </div>
              </div>
              <AriaButton
                aria-label="Закрыть"
                onPress={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <IconX size={16} stroke={1.8} />
              </AriaButton>
            </div>

            {/* Two columns, not four: "Администратор платформы" and a full date
                do not fit a quarter of a dialog, and a truncated fact is worse
                than a second row. */}
            <dl className="grid grid-cols-2 gap-4 border-b border-slate-100 p-5 text-sm">
              <Fact label="Роль" value={ROLE_LABEL[person.role] ?? person.role} />
              <Fact
                label="Был на портале"
                value={person.online ? seenAgo(person.seen_ago) : fmtRecent(person.last_seen)}
                title={fmtDateTime(person.last_seen)}
              />
              <Fact
                label="Первый вход"
                value={fmtDateTime(person.first_seen)}
                title={fmtDateTime(person.first_seen)}
              />
              <Fact label="Заходов" value={String(person.visits)} />
            </dl>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">Последние действия</h3>
              {loading ? (
                <SkeletonRows rows={3} />
              ) : error ? (
                <ErrorBox error={error} />
              ) : (
                <ActivityFeed events={data?.events ?? []} showActor={false} />
              )}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800" title={title}>
        {value}
      </dd>
    </div>
  );
}

// One line of the feed: an event, and how many times in a row the same person
// did the same thing to the same service.
type FeedItem = { event: ActivityEvent; times: number };

// collapse folds a run of identical events into one line. Saving a version
// twenty times is one thing that happened, and left as twenty rows it pushes
// everything else off the page.
function collapse(events: ActivityEvent[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    const same =
      last &&
      last.event.actor === e.actor &&
      last.event.source === e.source &&
      last.event.event_type === e.event_type &&
      last.event.subject_id === e.subject_id;
    if (same) last.times += 1;
    else out.push({ event: e, times: 1 });
  }
  return out;
}

// ActivityFeed: what people have been doing lately. Only what a person did: the
// background loops write to the same journals, and their rows would bury the
// answer to the question this page asks.
//
// showActor is off inside one person's card, where every line would otherwise
// start with the same name.
function ActivityFeed({
  events,
  showActor = true,
  empty,
}: {
  events: ActivityEvent[];
  showActor?: boolean;
  empty?: string;
}) {
  const items = collapse(events);
  if (events.length === 0) {
    return (
      <Card className="text-sm text-slate-500">
        {empty ??
          (showActor
            ? "Пока ничего не происходило. Здесь появятся заказы, публикации и согласования."
            : "Этот человек пока ничего не делал в портале.")}
      </Card>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-surface shadow-sm">
      <ul className="divide-y divide-slate-100">
        {items.map(({ event: e, times }) => (
          <li
            key={`${e.source}-${e.subject_id}-${e.at}-${e.event_type}`}
            className="flex gap-3 px-4 py-3"
          >
            {showActor && <Avatar name={personName(e.actor_name, e.actor)} />}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-700">
                {showActor && (
                  <>
                    <span className="font-medium text-slate-800">
                      {personName(e.actor_name, e.actor)}
                    </span>{" "}
                  </>
                )}
                {actionText(e)} <span className="font-medium text-slate-800">{e.title}</span>
                {times > 1 && (
                  <span className="text-slate-400">
                    {" "}
                    {times} {ruPlural(times, "раз", "раза", "раз")}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {e.team ? `${e.team} · ` : ""}
                <span title={fmtDateTime(e.at)}>{fmtRecent(e.at)}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {showActor && (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          {events.length} {ruPlural(events.length, "действие", "действия", "действий")} за последнее
          время. Полная история каждого заказа и публикации остаётся на их страницах.
        </p>
      )}
    </div>
  );
}
