import { Heading } from "react-aria-components";
import type { PlatformUser } from "@/api/types";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { ActivityFeed, OrderSelect, useFeed } from "./ActivityFeed";
import {
  Avatar,
  CardSheet,
  CloseButton,
  displayName,
  Fact,
  OnlinePill,
  ROLE_LABEL,
  TeamChips,
} from "./parts";
import { seenAgo } from "./text";

// One person, opened from anywhere their name appears. Their own actions are
// fetched for them rather than filtered out of the platform's feed: that feed
// holds the last few dozen events, and somebody who has not acted today would
// come back from it empty.
export function UserCard({ person, onClose }: { person: PlatformUser; onClose: () => void }) {
  const feed = useFeed({ actor: person.subject });
  const name = displayName(person);
  return (
    <CardSheet onClose={onClose}>
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
            <TeamChips teams={person.teams} />
          </div>
        </div>
        <CloseButton onPress={onClose} />
      </div>

      <dl className="grid grid-cols-2 gap-4 border-b border-slate-100 p-5 text-sm sm:grid-cols-4">
        <Fact label="Роль" value={ROLE_LABEL[person.role] ?? person.role} />
        <Fact
          label="Был на портале"
          value={person.online ? seenAgo(person.seen_ago) : fmtRecent(person.last_seen)}
          title={fmtDateTime(person.last_seen)}
        />
        <Fact label="Первый вход" value={fmtDateTime(person.first_seen)} />
        <Fact label="Заходов" value={String(person.visits)} />
      </dl>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Действия</h3>
          <OrderSelect feed={feed} />
        </div>
        <ActivityFeed feed={feed} showActor={false} />
      </div>
    </CardSheet>
  );
}
