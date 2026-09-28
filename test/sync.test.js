import test from "node:test";
import assert from "node:assert/strict";
import { addDays, changedGames, planWeeks } from "../worker/sync.js";
import { parseWeek } from "../worker/nhl.js";

const config = {
  season: 20262027,
  seasonStart: "2026-09-29",
  seasonEnd: "2027-04-10",
  gameTypes: [2],
};

test("addDays crosses month and year borders", () => {
  assert.equal(addDays("2026-12-30", 7), "2027-01-06");
  assert.equal(addDays("2026-10-01", -2), "2026-09-29");
});

test("a run fetches the current week plus six backfill weeks", () => {
  const plan = planWeeks({ today: "2026-11-10", backfillCursor: "2026-10-13", config });
  assert.deepEqual(plan.weeks, [
    "2026-11-07",
    "2026-10-13",
    "2026-10-20",
    "2026-10-27",
    "2026-11-03",
    "2026-11-10",
    "2026-11-17",
  ]);
  assert.equal(plan.nextBackfillCursor, "2026-11-24");
});

test("the first run starts backfilling at the season start", () => {
  const plan = planWeeks({ today: "2026-09-28", backfillCursor: null, config });
  assert.deepEqual(plan.weeks.slice(0, 3), ["2026-09-29", "2026-10-06", "2026-10-13"]);
  assert.equal(plan.weeks.length, 6, "the current week and the first backfill week are the same");
  assert.equal(plan.nextBackfillCursor, "2026-11-10");
});

test("the backfill cursor wraps around at the end of the season", () => {
  const plan = planWeeks({ today: "2026-11-10", backfillCursor: "2027-04-06", config });
  assert.deepEqual(plan.weeks, ["2026-11-07", "2027-04-06"]);
  assert.equal(plan.nextBackfillCursor, "2026-09-29");
});

test("the whole season is revisited within five runs", () => {
  const seen = new Set();
  let cursor = null;
  for (let run = 0; run < 5; run++) {
    const plan = planWeeks({ today: "2026-12-01", backfillCursor: cursor, config });
    plan.weeks.forEach((week) => seen.add(week));
    cursor = plan.nextBackfillCursor;
  }
  for (let date = config.seasonStart; date <= config.seasonEnd; date = addDays(date, 7)) {
    assert.ok(seen.has(date), `week ${date} was fetched`);
  }
});

test("nothing is fetched once the season is long over", () => {
  const plan = planWeeks({ today: "2027-07-01", backfillCursor: "2026-10-13", config });
  assert.deepEqual(plan.weeks, []);
});

test("only new or changed games are written", () => {
  const stored = { id: 1, gameDate: "2026-10-01", startTime: "t", state: "FUT", scheduleState: "OK", away: "A", home: "B", awayScore: null, homeScore: null, lastPeriodType: null };
  const same = { ...stored };
  const finished = { ...stored, id: 2, state: "OFF", awayScore: 2, homeScore: 1, lastPeriodType: "REG" };
  const brandNew = { ...stored, id: 3 };
  const changed = changedGames([same, finished, brandNew], [stored, { ...stored, id: 2 }]);
  assert.deepEqual(changed.map((game) => game.id), [2, 3]);
});

test("the last days of the season are still refreshed", () => {
  const plan = planWeeks({ today: "2027-04-11", backfillCursor: "2026-10-13", config });
  assert.equal(plan.weeks[0], "2027-04-08");
});

test("schedule weeks are flattened and filtered", () => {
  const team = (abbrev, score) => ({ abbrev, ...(score == null ? {} : { score }) });
  const payload = {
    nextStartDate: "2026-10-13",
    gameWeek: [
      {
        date: "2026-10-06",
        games: [
          { id: 1, season: 20262027, gameType: 2, startTimeUTC: "2026-10-06T23:00:00Z", gameState: "OFF", gameScheduleState: "OK", awayTeam: team("CAR", 2), homeTeam: team("MTL", 3), gameOutcome: { lastPeriodType: "OT" } },
          { id: 2, season: 20262027, gameType: 1, startTimeUTC: "2026-10-06T23:00:00Z", gameState: "OFF", gameScheduleState: "OK", awayTeam: team("NSH", 1), homeTeam: team("TOR", 0) },
          { id: 3, season: 20252026, gameType: 2, startTimeUTC: "2026-10-06T23:00:00Z", gameState: "OFF", gameScheduleState: "OK", awayTeam: team("NSH", 1), homeTeam: team("TOR", 0) },
        ],
      },
      { date: "2026-10-07", games: [{ id: 4, season: 20262027, gameType: 2, startTimeUTC: "2026-10-07T23:00:00Z", gameState: "FUT", gameScheduleState: "OK", awayTeam: team("PIT"), homeTeam: team("WSH") }] },
    ],
  };
  const week = parseWeek(payload, config);
  assert.equal(week.nextStartDate, "2026-10-13");
  assert.deepEqual(week.games.map((game) => game.id), [1, 4]);
  assert.deepEqual(week.games[0], {
    id: 1, season: 20262027, gameType: 2, gameDate: "2026-10-06", startTime: "2026-10-06T23:00:00Z",
    state: "OFF", scheduleState: "OK", away: "CAR", home: "MTL", awayScore: 2, homeScore: 3, lastPeriodType: "OT",
  });
  assert.equal(week.games[1].awayScore, null);
});
