import { Button as AriaButton, Heading, TabList, TabPanel, Tabs } from "react-aria-components";
import type { PlatformUser, TeamActivity } from "@/api/types";
import { Card } from "@/components/ui";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { ActivityFeed, OrderSelect, useFeed } from "./ActivityFeed";
import {
  Avatar,
  CardSheet,
  CardTab,
  CloseButton,
  displayName,
  Fact,
  OnlinePill,
  ROLE_LABEL,
} from "./parts";
import { seenAgo } from "./text";

// One team: who is in it and what the people in it have been doing. A team is
// not a thing the portal keeps - it is a group in the token - so everything
// here is derived from the people who have signed in from it.
export function TeamCard({
  team,
  onClose,
  onOpenPerson,
}: {
  team: TeamActivity;
  onClose: () => void;
  onOpenPerson: (p: PlatformUser) => void;
}) {
  const feed = useFeed({ team: team.team });
  const people = team.people ?? [];
  return (
    <CardSheet onClose={onClose}>
      <div className="flex items-start gap-3 border-b border-slate-100 p-5">
        <div className="min-w-0 flex-1">
          <Heading slot="title" className="text-base font-semibold text-slate-800">
            Команда {team.team}
          </Heading>
          {/* No count in the sentence: the numbers are right below it, and a
              Russian verb would have to agree with each of them. */}
          <p className="mt-0.5 text-sm text-slate-500">
            Команда собирается из групп в токене. Здесь те, кто из неё заходил в портал.
          </p>
        </div>
        <CloseButton onPress={onClose} />
      </div>

      <dl className="grid grid-cols-3 gap-4 border-b border-slate-100 p-5 text-sm">
        <Fact label="Людей" value={String(team.members)} />
        <Fact label="Сейчас в сети" value={String(team.online)} />
        <Fact label="Заходили за сутки" value={String(team.active_24h)} />
      </dl>

      <Tabs className="flex min-h-0 flex-1 flex-col">
        <TabList aria-label="Что показать о команде" className="flex gap-1 border-b border-gray-200 px-5">
          <CardTab id="people">Люди</CardTab>
          <CardTab id="actions">Действия</CardTab>
        </TabList>

        <TabPanel id="people" className="min-h-0 flex-1 overflow-y-auto p-5 outline-none">
          {people.length === 0 ? (
            <Card className="text-sm text-slate-500">
              Из этой команды пока никто не заходил.
            </Card>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface">
              {people.map((p) => (
                <li key={p.subject}>
                  <AriaButton
                    onPress={() => onOpenPerson(p)}
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none hover:bg-slate-50 focus-visible:bg-slate-50"
                  >
                    <Avatar name={displayName(p)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">
                          {displayName(p)}
                        </span>
                        {p.online && <OnlinePill />}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        {ROLE_LABEL[p.role] ?? p.role}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-xs text-slate-500"
                      title={fmtDateTime(p.last_seen)}
                    >
                      {p.online ? seenAgo(p.seen_ago) : fmtRecent(p.last_seen)}
                    </span>
                  </AriaButton>
                </li>
              ))}
            </ul>
          )}
        </TabPanel>

        <TabPanel id="actions" className="min-h-0 flex-1 overflow-y-auto p-5 outline-none">
          <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Всё, что делали люди этой команды с её заказами и публикациями.
            </p>
            <OrderSelect feed={feed} />
          </div>
          <ActivityFeed feed={feed} empty={`У команды ${team.team} пока нет действий.`} />
        </TabPanel>
      </Tabs>
    </CardSheet>
  );
}
