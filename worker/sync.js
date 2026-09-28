// Copies NHL results into D1. A run refreshes the week around today and also
// re-reads six weeks from a rolling cursor, so the whole season (including
// rescheduled games) is revisited every five days.
//
// Runs stay small on purpose: the Workers free plan allows about 10 ms of CPU
// and 50 outgoing requests per invocation.

import { CONFIG } from "./config.js";
import { fetchWeek } from "./nhl.js";
import { getGamesBetween, getMeta, setMetaStatement, upsertGameStatement } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_WEEKS_PER_RUN = 6;
// The "current" week starts this many days back. Runs are a day apart, so
// this also picks up the results of a run that failed.
const LOOKBACK_DAYS = 3;
// Syncing stops this long after the season is over.
const GRACE_DAYS = 14;
const WRITE_CHUNK = 50;

export function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

// Dates whose schedule week should be fetched in this run.
export function planWeeks({ today, backfillCursor, config = CONFIG }) {
  const start = config.seasonStart;
  const end = config.seasonEnd;
  const weeks = [];
  if (today > addDays(end, GRACE_DAYS)) return { weeks, nextBackfillCursor: backfillCursor ?? start };

  const lookback = addDays(today, -LOOKBACK_DAYS);
  const currentWeek = lookback < start ? start : lookback;
  if (currentWeek <= end) weeks.push(currentWeek);

  let cursor = backfillCursor && backfillCursor >= start && backfillCursor <= end ? backfillCursor : start;
  for (let i = 0; i < BACKFILL_WEEKS_PER_RUN; i++) {
    if (!weeks.includes(cursor)) weeks.push(cursor);
    cursor = addDays(cursor, 7);
    if (cursor > end) {
      cursor = start;
      break;
    }
  }
  return { weeks, nextBackfillCursor: cursor };
}

const COMPARED_FIELDS = [
  "gameDate",
  "startTime",
  "state",
  "scheduleState",
  "away",
  "home",
  "awayScore",
  "homeScore",
  "lastPeriodType",
];

export function changedGames(fetched, existing) {
  const known = new Map(existing.map((game) => [game.id, game]));
  return fetched.filter((game) => {
    const before = known.get(game.id);
    return !before || COMPARED_FIELDS.some((field) => before[field] !== game[field]);
  });
}

export async function syncGames(env, { now = new Date(), fetcher = fetch } = {}) {
  const db = env.DB;
  const today = now.toISOString().slice(0, 10);
  const { weeks, nextBackfillCursor } = planWeeks({
    today,
    backfillCursor: await getMeta(db, "backfill_cursor"),
  });

  const fetched = new Map();
  for (const week of weeks) {
    const { games } = await fetchWeek(week, CONFIG, fetcher);
    for (const game of games) fetched.set(game.id, game);
  }

  let written = 0;
  if (fetched.size > 0) {
    const dates = [...fetched.values()].map((game) => game.gameDate).sort();
    const existing = await getGamesBetween(db, dates[0], dates[dates.length - 1]);
    const changed = changedGames([...fetched.values()], existing);
    for (let i = 0; i < changed.length; i += WRITE_CHUNK) {
      const chunk = changed.slice(i, i + WRITE_CHUNK);
      await db.batch(chunk.map((game) => upsertGameStatement(db, game)));
    }
    written = changed.length;
  }

  await db.batch([
    setMetaStatement(db, "backfill_cursor", nextBackfillCursor),
    setMetaStatement(db, "last_synced_at", now.toISOString()),
    setMetaStatement(db, "last_sync_error", ""),
  ]);
  return { weeks, fetched: fetched.size, written };
}
