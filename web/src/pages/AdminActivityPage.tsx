import {
  IconExternalLink,
  IconRefresh,
  IconSettings,
  IconUser,
  IconUserCheck,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "react-aria-components";
import { api } from "@/api/client";
import type { ActivityEvent, PlatformUser, TeamActivity } from "@/api/types";
import { Button, buttonClass, Card, Chip, ErrorBox, SkeletonRows, TextField } from "@/components/ui";
import { ruPlural } from "@/form/fieldErrors";
import { useAsync } from "@/hooks/useAsync";
import { safeHref } from "@/lib/href";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { StatCard } from "./AdminSection";
import { actionText, initials, personName, seenAgo } from "./activityText";

// Who uses the portal. The admin has no other way of telling a platform three
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

export function AdminActivityPage() {
  const { data, error, loading, reload } = useAsync((s) => api.getActivity(s), []);
  // The online half re-asks on its own. It is the only part of the page that
  // goes stale while somebody is reading it.
  const { data: live } = useAsync((s) => api.getOnline(s), [], undefined, {
    refetchInterval: ONLINE_REFRESH_MS,
  });
  const [query, setQuery] = useState("");

  const online = live?.online ?? data?.online ?? [];
  const users = useMemo(() => data?.users ?? [], [data]);
  const found = useMemo(() => matching(users, query), [users, query]);

  if (loading) return <SkeletonRows rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const totals = data?.totals;
  const grafana = safeHref(data?.grafana_url);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col">
        <div className="mb-4 flex min-h-9 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">Кто пользуется порталом</h1>
            <Chip className="bg-brand-50 text-brand-700">
              <IconSettings size={13} stroke={1.8} className="text-brand-400" />
              Admin
            </Chip>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Сейчас в сети" value={online.length} tone="emerald" Icon={IconUserCheck} />
          <StatCard label="Заходили за сутки" value={totals?.active_24h ?? 0} tone="brand" Icon={IconUser} />
          <StatCard label="Заходили за неделю" value={totals?.active_7d ?? 0} tone="slate" Icon={IconUsers} />
          <StatCard label="Команд на платформе" value={totals?.teams ?? 0} tone="amber" Icon={IconUsersGroup} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Портал знает тех, кто хотя бы раз в него заходил. Человек считается в сети, если его
          браузер обращался к порталу за последние{" "}
          {Math.round((data?.online_window_seconds ?? 300) / 60)} мин. Список обновляется сам каждые{" "}
          {ONLINE_REFRESH_MS / 1000} сек.
        </p>
      </section>

      <OnlineSection people={online} />

      <TeamsSection teams={data?.teams ?? []} onPick={setQuery} />

      <section className="flex flex-col">
        <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">
            Люди <span className="font-normal text-slate-400">{users.length}</span>
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
        <PeopleTable people={found} total={users.length} />
      </section>

      <section className="flex flex-col">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Последние действия</h2>
        <ActivityFeed events={data?.events ?? []} />
      </section>
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

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
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

function OnlineSection({ people }: { people: PlatformUser[] }) {
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
            <Card key={p.subject} className="flex items-center gap-3">
              <Avatar name={personName(p.name, p.subject)} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">
                  {personName(p.name, p.subject)}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span className="truncate">
                    {p.teams.length > 0 ? p.teams.join(", ") : "без команды"}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="shrink-0">{seenAgo(p.seen_ago)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// TeamsSection: how big each team is and how much of it is around. A row hands
// its team to the search box below, which is where the composition is.
function TeamsSection({ teams, onPick }: { teams: TeamActivity[]; onPick: (team: string) => void }) {
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
                onAction={() => onPick(t.team)}
                className="cursor-pointer border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50"
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

function PeopleTable({ people, total }: { people: PlatformUser[]; total: number }) {
  const shown = people.slice(0, DIRECTORY_ROWS);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface shadow-sm">
      <Table aria-label="Люди на платформе" className="w-full min-w-[48rem] text-sm">
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
              className="border-b border-slate-100 outline-none last:border-0 hover:bg-slate-50"
            >
              <Cell className="px-4 py-3 text-left">
                <span className="flex items-center gap-3">
                  <Avatar name={personName(p.name, p.subject)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-800">
                        {personName(p.name, p.subject)}
                      </span>
                      {p.online && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          в сети
                        </span>
                      )}
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
                <span title={fmtDateTime(p.last_seen)}>{fmtRecent(p.last_seen)}</span>
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
function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const items = collapse(events);
  if (events.length === 0) {
    return (
      <Card className="text-sm text-slate-500">
        Пока ничего не происходило. Здесь появятся заказы, публикации и согласования.
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
            <Avatar name={personName(e.actor_name, e.actor)} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-700">
                <span className="font-medium text-slate-800">
                  {personName(e.actor_name, e.actor)}
                </span>{" "}
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
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        {events.length} {ruPlural(events.length, "действие", "действия", "действий")} за последнее
        время. Полная история каждого заказа и публикации остаётся на их страницах.
      </p>
    </div>
  );
}
