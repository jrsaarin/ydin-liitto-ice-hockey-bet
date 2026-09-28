import test from "node:test";
import assert from "node:assert/strict";
import { describeDraft, positionForPick, roundOf, shuffle } from "../worker/draft.js";

test("snake order reverses every other round", () => {
  const positions = [];
  for (let pick = 1; pick <= 28; pick++) positions.push(positionForPick(pick, 7));
  assert.deepEqual(positions, [
    0, 1, 2, 3, 4, 5, 6,
    6, 5, 4, 3, 2, 1, 0,
    0, 1, 2, 3, 4, 5, 6,
    6, 5, 4, 3, 2, 1, 0,
  ]);
});

test("rounds are counted per lap of the player list", () => {
  assert.equal(roundOf(1, 7), 1);
  assert.equal(roundOf(7, 7), 1);
  assert.equal(roundOf(8, 7), 2);
  assert.equal(roundOf(28, 7), 4);
});

test("shuffle keeps every item exactly once", () => {
  const names = ["a", "b", "c", "d", "e", "f", "g"];
  const shuffled = shuffle(names);
  assert.deepEqual([...shuffled].sort(), names);
  assert.deepEqual(names, ["a", "b", "c", "d", "e", "f", "g"], "input is left untouched");
});

test("shuffle follows the random source", () => {
  // Always swapping with index 0 rotates the list in a known way.
  assert.deepEqual(shuffle([1, 2, 3, 4], () => 0), [2, 3, 4, 1]);
});

const players = [
  { id: 11, name: "Third", draftPosition: 2 },
  { id: 12, name: "First", draftPosition: 0 },
  { id: 13, name: "Second", draftPosition: 1 },
];

test("an empty league is in setup", () => {
  const draft = describeDraft([], [], 4);
  assert.equal(draft.status, "setup");
  assert.equal(draft.onTheClock, null);
});

test("the player on the clock follows the snake", () => {
  const picks = [
    { pickNumber: 1, playerId: 12, team: "CAR" },
    { pickNumber: 2, playerId: 13, team: "FLA" },
    { pickNumber: 3, playerId: 11, team: "EDM" },
  ];
  const draft = describeDraft(players, picks, 2);
  assert.equal(draft.status, "drafting");
  assert.deepEqual(draft.onTheClock, { pickNumber: 4, round: 2, playerId: 11 });
  assert.deepEqual(draft.players.map((player) => player.name), ["First", "Second", "Third"]);
  assert.deepEqual(draft.players[0].teams, ["CAR"]);
});

test("the draft completes when every player has all teams", () => {
  const picks = [
    { pickNumber: 1, playerId: 12, team: "CAR" },
    { pickNumber: 2, playerId: 13, team: "FLA" },
    { pickNumber: 3, playerId: 11, team: "EDM" },
    { pickNumber: 4, playerId: 11, team: "DAL" },
    { pickNumber: 5, playerId: 13, team: "COL" },
    { pickNumber: 6, playerId: 12, team: "TOR" },
  ];
  const draft = describeDraft(players, picks, 2);
  assert.equal(draft.status, "complete");
  assert.equal(draft.onTheClock, null);
  assert.deepEqual(draft.players[0].teams, ["CAR", "TOR"]);
  assert.equal(draft.picks[5].round, 2);
});
