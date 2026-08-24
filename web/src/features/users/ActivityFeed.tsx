import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";
import type { ActivityEvent } from "@/api/types";
import { Button, Card, ErrorBox, Select, SkeletonRows } from "@/components/ui";
import { ruPlural } from "@/form/fieldErrors";
import { fmtDateTime, fmtRecent } from "@/lib/time";
import { Avatar } from "./parts";
import { actionText, personName } from "./text";

// What people have been doing. The same list serves the whole platform, one
// team and one person, because it is the same question asked of a narrower set.

type Scope = { actor?: string; team?: string };
type Order = "newest" | "oldest";

const ORDER_OPTIONS: { id: Order; label: string }[] = [
  { id: "newest", label: "Сначала новые" },
  { id: "oldest", label: "Сначала старые" },
];

export interface Feed {
  items: ActivityEvent[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  order: Order;
  setOrder: (o: Order) => void;
  loadMore: () => void;
}

// useFeed keeps one list that grows. Paging is by the time of the last event
// rather than by an offset: events keep arriving while somebody reads, and an
// offset would hand them the same row twice or skip one.
export function useFeed({ actor, team }: Scope): Feed {
  const [order, setOrder] = useState<Order>("newest");
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // The first page, again whenever the scope or the order changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getUserEvents({ actor, team, sort: order })
      .then((r) => {
        if (!alive) return;
        setItems(r.events);
        setHasMore(r.has_more);
      })
      .catch((e: Error) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [actor, team, order]);

  const loadMore = useCallback(() => {
    const last = items[items.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    api
      .getUserEvents({ actor, team, sort: order, cursor: last.at })
      .then((r) => {
        setItems((prev) => [...prev, ...r.events]);
        setHasMore(r.has_more);
      })
      .catch((e: Error) => setError(e))
      .finally(() => setLoadingMore(false));
  }, [actor, team, order, items, loadingMore]);

  return { items, hasMore, loading, loadingMore, error, order, setOrder, loadMore };
}

// OrderSelect is the feed's only control: which end of the history to read
// from. Everything else about the list is decided by where it is shown.
export function OrderSelect({ feed }: { feed: Feed }) {
  return (
    <div className="w-40">
      <Select<Order>
        label="Порядок событий"
        hideLabel
        compact
        selectedKey={feed.order}
        onSelectionChange={feed.setOrder}
        options={ORDER_OPTIONS}
      />
    </div>
  );
}

// One line of the feed: an event, and how many times in a row the same person
// did the same thing to the same service.
type FeedItem = { event: ActivityEvent; times: number };

// collapse folds a run of identical events into one line. Saving a version
// twenty times is one thing that happened, and left as twenty rows it pushes
// everything else off the page. It runs over the whole loaded list, so a run
// split across two pages still reads as one line.
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

// ActivityFeed shows what the feed has loaded so far and asks for the next page
// on request. Only what a person did: the background loops write to the same
// journals, and their rows would bury the answer these screens are for.
//
// showActor is off inside one person's card, where every line would otherwise
// start with the same name.
export function ActivityFeed({
  feed,
  showActor = true,
  empty,
}: {
  feed: Feed;
  showActor?: boolean;
  empty?: string;
}) {
  if (feed.loading) return <SkeletonRows rows={4} />;
  if (feed.error) return <ErrorBox error={feed.error} />;
  if (feed.items.length === 0) {
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
        {collapse(feed.items).map(({ event: e, times }) => (
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
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500">
          {feed.items.length} {ruPlural(feed.items.length, "действие", "действия", "действий")}.
          Полная история заказа или публикации остаётся на его странице.
        </p>
        {feed.hasMore && (
          <Button
            variant="secondary"
            onPress={feed.loadMore}
            isDisabled={feed.loadingMore}
            className="shrink-0"
          >
            {feed.loadingMore ? "Загружаем…" : "Показать ещё"}
          </Button>
        )}
      </div>
    </div>
  );
}
