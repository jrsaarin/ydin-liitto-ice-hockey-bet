import test from "node:test";
import assert from "node:assert/strict";
import { computeCup, rankPlayers } from "../worker/cup.js";

// Owners: player 1 has CAR and TOR, player 2 has FLA, player 3 has EDM.
// BOS is nobody's team.
const owners = { CAR: 1, TOR: 1, FLA: 2, EDM: 3 };
const NOW = Date.parse("2026-10-20T12:00:00Z");

let nextId = 1;
function game(day, away, home, awayScore, homeScore, extra = {}) {
  const played = awayScore != null;
  return {
    id: nextId++,
    startTime: `2026-10-${String(day).padStart(2, "0")}T23:00:00Z`,
    state: played ? "OFF" : "FUT",
    scheduleState: "OK",
    away,
    home,
    awayScore: awayScore ?? null,
    homeScore: homeScore ?? null,
    lastPeriodType: played ? "REG" : null,
    ...extra,
  };
}

function run(games, options = {}) {
  return computeCup({ games, owners, startingHolder: "CAR", now: NOW, ...options });
}

// The stats without the tie-breakers, which have tests of their own.
function tally({ points, defenses, captures }) {
  return { points, defenses, captures };
}

test("with no games the starting holder keeps the cup", () => {
  const cup = run([]);
  assert.equal(cup.holder, "CAR");
  assert.equal(cup.holderOwner, 1);
  assert.deepEqual(cup.history, []);
  assert.equal(cup.nextGame, null);
});

test("a defense keeps the cup and scores a point", () => {
  const cup = run([game(1, "FLA", "CAR", 1, 3)]);
  assert.equal(cup.holder, "CAR");
  assert.deepEqual(tally(cup.playerStats[1]), { points: 1, defenses: 1, captures: 0 });
  assert.equal(cup.history[0].changedHands, false);
  assert.equal(cup.history[0].pointTo, 1);
  assert.equal(cup.streak, 1);
});

test("a loss moves the cup and the point to the winner", () => {
  const cup = run([game(1, "FLA", "CAR", 4, 3), game(3, "FLA", "EDM", 2, 1), game(5, "EDM", "FLA", 5, 0)]);
  assert.equal(cup.holder, "EDM");
  assert.equal(cup.holderOwner, 3);
  // FLA won games 1 and 2, EDM won game 3. CAR lost its only cup game.
  assert.deepEqual(tally(cup.playerStats[1]), { points: 0, defenses: 0, captures: 0 });
  assert.deepEqual(tally(cup.playerStats[2]), { points: 2, defenses: 1, captures: 1 });
  assert.deepEqual(tally(cup.playerStats[3]), { points: 1, defenses: 0, captures: 1 });
  assert.deepEqual(cup.teamStats.FLA, { points: 2 });
  assert.deepEqual(cup.teamStats.CAR, { points: 0 });
  assert.deepEqual(cup.history.map((entry) => entry.pointTo), [2, 2, 3]);
  assert.equal(cup.streak, 0);
});

test("every cup game between drafted teams gives exactly one point", () => {
  const cup = run([game(1, "FLA", "CAR", 4, 3), game(3, "FLA", "EDM", 2, 1), game(5, "TOR", "FLA", 0, 1)]);
  const total = Object.values(cup.playerStats).reduce((sum, stats) => sum + stats.points, 0);
  assert.equal(total, cup.history.length);
});

test("games that do not involve the holder are irrelevant", () => {
  const cup = run([game(1, "FLA", "EDM", 9, 0), game(2, "TOR", "EDM", 1, 2)]);
  assert.equal(cup.holder, "CAR");
  assert.deepEqual(cup.history, []);
});

test("beating an undrafted team scores a point", () => {
  const cup = run([game(1, "BOS", "CAR", 1, 5)]);
  assert.equal(cup.holder, "CAR");
  assert.deepEqual(tally(cup.playerStats[1]), { points: 1, defenses: 1, captures: 0 });
  assert.equal(cup.history[0].pointTo, 1);
  assert.equal(cup.history[0].changedHands, false);
});

test("losing to an undrafted team keeps the cup and nobody scores", () => {
  const cup = run([game(1, "BOS", "CAR", 5, 1), game(2, "CAR", "FLA", 2, 1)]);
  assert.equal(cup.holder, "CAR");
  assert.equal(cup.holderOwner, 1);
  assert.equal(cup.history.length, 2);
  // Only the win over Florida counts.
  assert.deepEqual(tally(cup.playerStats[1]), { points: 1, defenses: 1, captures: 0 });
  assert.deepEqual(cup.teamStats.CAR, { points: 1 });

  const lost = cup.history[0];
  assert.equal(lost.winner, "BOS");
  assert.equal(lost.challengerOwner, null);
  assert.equal(lost.pointTo, null);
  assert.equal(lost.changedHands, false);
  assert.equal(cup.streak, 2);
});

test("an upcoming game against an undrafted team is the next cup game", () => {
  const cup = run([game(21, "BOS", "CAR"), game(22, "CAR", "FLA")]);
  assert.equal(cup.nextGame.challenger, "BOS");
  assert.equal(cup.nextGame.challengerOwner, null);
});

test("the cup can move between two teams of the same player", () => {
  const cup = run([game(1, "TOR", "CAR", 3, 2)]);
  assert.equal(cup.holder, "TOR");
  assert.equal(cup.holderOwner, 1);
  // The owner wins the game either way, but it is not a capture.
  assert.deepEqual(tally(cup.playerStats[1]), { points: 1, defenses: 0, captures: 0 });
  assert.deepEqual(cup.teamStats.TOR, { points: 1 });
});

test("overtime and shootout results count like any other", () => {
  const cup = run([game(1, "FLA", "CAR", 3, 2, { lastPeriodType: "SO" })]);
  assert.equal(cup.holder, "FLA");
  assert.equal(cup.history[0].lastPeriodType, "SO");
});

test("the chain follows time order even if input is unsorted", () => {
  const first = game(1, "FLA", "CAR", 2, 1);
  const second = game(2, "EDM", "FLA", 3, 0);
  assert.equal(run([second, first]).holder, "EDM");
});

test("the next unplayed game of the holder is reported", () => {
  const cup = run([game(19, "FLA", "CAR", 2, 1), game(21, "TOR", "EDM"), game(22, "FLA", "EDM")]);
  assert.equal(cup.holder, "FLA");
  assert.equal(cup.nextGame.challenger, "EDM");
  assert.equal(cup.nextGame.challengerOwner, 3);
  assert.equal(cup.nextGame.live, false);
});

test("a live game is flagged and not scored yet", () => {
  const cup = run([game(20, "FLA", "CAR", 1, 0, { state: "LIVE" })]);
  assert.equal(cup.holder, "CAR");
  assert.equal(cup.nextGame.live, true);
  assert.deepEqual(cup.history, []);
});

test("later results wait for an earlier unfinished game", () => {
  const cup = run([game(19, "FLA", "CAR"), game(20, "EDM", "CAR", 5, 1)]);
  assert.equal(cup.holder, "CAR");
  assert.deepEqual(cup.history, []);
  assert.equal(cup.nextGame.challenger, "FLA");
});

test("postponed games are skipped", () => {
  const cup = run([
    game(10, "FLA", "CAR", null, null, { scheduleState: "PPD" }),
    game(12, "EDM", "CAR", 5, 1),
  ]);
  assert.equal(cup.holder, "EDM");
});

test("an unfinished game long in the past does not freeze the cup", () => {
  const cup = run([game(10, "FLA", "CAR"), game(12, "EDM", "CAR", 5, 1)]);
  assert.equal(cup.holder, "EDM");
  assert.equal(cup.history.length, 1);
});

test("an undrafted starting holder scores for nobody until beaten", () => {
  const cup = computeCup({
    games: [
      game(1, "CHI", "BOS", 5, 0), // two undrafted teams: not part of the bet
      game(2, "FLA", "BOS", 1, 2),
      game(3, "CAR", "BOS", 0, 1),
      game(4, "EDM", "BOS", 4, 1),
    ],
    owners,
    startingHolder: "BOS",
    now: NOW,
  });
  assert.equal(cup.holder, "EDM");
  assert.equal(cup.history.length, 3);
  // Losing to the undrafted holder scores nothing. Beating it scores and takes the cup.
  assert.deepEqual(cup.history.map((entry) => entry.pointTo), [null, null, 3]);
  assert.deepEqual(tally(cup.playerStats[3]), { points: 1, defenses: 0, captures: 1 });
  const total = Object.values(cup.playerStats).reduce((sum, stats) => sum + stats.points, 0);
  assert.equal(total, 1);
});

test("a win streak follows the player across teams and ends when someone else wins", () => {
  const cup = run([
    game(1, "FLA", "CAR", 1, 3),
    game(2, "TOR", "CAR", 3, 2), // same owner: the streak goes on
    game(3, "BOS", "TOR", 2, 1), // lost to an undrafted team: the streak ends
    game(4, "EDM", "TOR", 0, 1),
    game(5, "FLA", "TOR", 4, 1),
  ]);
  assert.equal(cup.playerStats[1].points, 3);
  assert.equal(cup.playerStats[1].longestStreak, 2);
  assert.equal(cup.playerStats[2].longestStreak, 1);
  assert.equal(cup.playerStats[3].longestStreak, 0);
});

test("the best team is the one with the most cup wins", () => {
  const cup = run([game(1, "FLA", "CAR", 1, 3), game(2, "TOR", "CAR", 3, 2), game(4, "EDM", "TOR", 0, 1)]);
  assert.deepEqual(cup.teamStats.TOR, { points: 2 });
  assert.deepEqual(cup.teamStats.CAR, { points: 1 });
  assert.equal(cup.playerStats[1].bestTeamWins, 2);
  assert.equal(cup.playerStats[2].bestTeamWins, 0);
});

test("the last time each player held the cup is recorded", () => {
  assert.equal(run([]).playerStats[1].lastHeld, 0);
  assert.equal(run([]).playerStats[2].lastHeld, null);

  const cup = run([game(1, "FLA", "CAR", 4, 3), game(3, "FLA", "EDM", 2, 1), game(5, "EDM", "FLA", 5, 0)]);
  // CAR held it only at the start, FLA until the third game, EDM holds it now.
  assert.equal(cup.playerStats[1].lastHeld, 0);
  assert.equal(cup.playerStats[2].lastHeld, 2);
  assert.equal(cup.playerStats[3].lastHeld, 3);
});

test("equal points are separated by streak, then best team, then the last holder", () => {
  const players = [
    { id: 1, name: "Aino" },
    { id: 2, name: "Bertta" },
    { id: 3, name: "Celia" },
    { id: 4, name: "Daavid" },
    { id: 5, name: "Eero" },
  ];
  const level = { points: 4, defenses: 0, captures: 0 };
  const stats = {
    1: { ...level, longestStreak: 2, bestTeamWins: 2, lastHeld: 3 },
    2: { ...level, longestStreak: 2, bestTeamWins: 2, lastHeld: 9 },
    3: { ...level, longestStreak: 2, bestTeamWins: 3, lastHeld: null },
    4: { ...level, longestStreak: 3, bestTeamWins: 1, lastHeld: null },
    5: { ...level, points: 5, longestStreak: 1, bestTeamWins: 1, lastHeld: null },
  };
  assert.deepEqual(rankPlayers(players, stats).map((row) => [row.rank, row.name]), [
    [1, "Eero"],
    [2, "Daavid"],
    [3, "Celia"],
    [4, "Bertta"],
    [5, "Aino"],
  ]);
});

test("holding the cup at the start beats never holding it", () => {
  const players = [
    { id: 1, name: "Aino" },
    { id: 2, name: "Bertta" },
  ];
  const level = { points: 1, defenses: 0, captures: 0, longestStreak: 1, bestTeamWins: 1 };
  const table = rankPlayers(players, { 1: { ...level, lastHeld: null }, 2: { ...level, lastHeld: 0 } });
  assert.deepEqual(table.map((row) => [row.rank, row.name]), [[1, "Bertta"], [2, "Aino"]]);
});

test("standings share a rank only when every tie-breaker is level", () => {
  const players = [
    { id: 1, name: "Aino" },
    { id: 2, name: "Bertta" },
    { id: 3, name: "Celia" },
    { id: 4, name: "Daavid" },
  ];
  const stats = {
    1: { points: 3, defenses: 2, captures: 1 },
    2: { points: 5, defenses: 4, captures: 1 },
    3: { points: 3, defenses: 1, captures: 2 },
  };
  const table = rankPlayers(players, stats);
  // Celia is listed above Aino for her captures, but they share second place:
  // captures are not a tie-breaker.
  assert.deepEqual(table.map((row) => [row.rank, row.name]), [
    [1, "Bertta"],
    [2, "Celia"],
    [2, "Aino"],
    [4, "Daavid"],
  ]);
  assert.equal(table[3].points, 0);
});
