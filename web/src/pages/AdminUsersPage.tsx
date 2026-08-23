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
import {
  Button as AriaButton,
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
} from "react-aria-components";
import { api } from "@/api/client";
import type { PlatformUser, TeamActivity } from "@/api/types";
import { Button, buttonClass, Card, Chip, ErrorBox, SkeletonRows, TextField } from "@/components/ui";
import { ActivityFeed, OrderSelect, useFeed } from "@/features/users/ActivityFeed";
import { Avatar, displayName, OnlinePill, ROLE_LABEL, TeamChips } from "@/features/users/parts";
import { TeamCard } from "@/features/users/TeamCard";
import { seenAgo } from "@/features/users/text";
import { UserCard } from "@/features/users/UserCard";
import { useAsync } from "@/hooks/useAsync";
import { safeHref } from "@/lib/href";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { StatCard } from "./AdminSection";

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
  const feed = useFeed({});
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState<PlatformUser | null>(null);
  const [team, setTeam] = useState<TeamActivity | null>(null);

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
  const found = useMemo(() => matching(users, query), [users, query]);

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

            <TeamsSection teams={data?.teams ?? []} onOpen={setTeam} />

            <section className="flex flex-col">
              <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-800">
                  Кто заходил <span className="font-normal text-slate-400">{users.length}</span>
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
              <PeopleTable people={found} total={users.length} onOpen={setPerson} />
            </section>

            <section className="flex flex-col">
              <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-800">Последние действия</h2>
                <OrderSelect feed={feed} />
              </div>
              <ActivityFeed feed={feed} />
            </section>
          </>
        )}
      </div>

      {person && <UserCard person={person} onClose={() => setPerson(null)} />}
      {!person && team && (
        <TeamCard
          team={team}
          onClose={() => setTeam(null)}
          onOpenPerson={(p) => {
            // One card at a time: opening a person from a team replaces the
            // team's card rather than stacking a dialog on a dialog.
            setTeam(null);
            setPerson(p);
          }}
        />
      )}
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
                <Avatar name={displayName(p)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {displayName(p)}
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

// TeamsSection: how big each team is and how much of it is around. A row opens
// the team: who is in it, and everything its people have done.
function TeamsSection({
  teams,
  onOpen,
}: {
  teams: TeamActivity[];
  onOpen: (t: TeamActivity) => void;
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
                onAction={() => onOpen(t)}
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
                  <Avatar name={displayName(p)} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-800">{displayName(p)}</span>
                      {p.online && <OnlinePill />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {p.email || p.username || p.subject}
                    </span>
                  </span>
                </span>
              </Cell>
              <Cell className="px-4 py-3 text-left">
                <TeamChips teams={p.teams} />
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
