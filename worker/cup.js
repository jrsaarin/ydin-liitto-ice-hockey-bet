// Pure cup-tracking logic: follows the cup from game to game.
//
// Rules:
// - The cup starts with `startingHolder`. Every game the holder plays is a
//   cup game, taken in time order.
// - The owner of the team that wins a cup game gets one point. Losing never
//   scores.
// - If a drafted team beats the holder, the cup moves to it.
// - An undrafted team cannot take the cup and has no owner to score for. If
//   it beats the holder, the cup stays and nobody gets a point.
// - An undrafted team can only hold the cup as the starting holder. Nobody
//   scores until a drafted team beats it.
// - Players level on points are separated by, in this order: the longest run
//   of cup games won in a row, the most wins by one of their teams, and who
//   held the cup most recently.

const FINAL_STATES = new Set(["OFF", "FINAL"]);
const LIVE_STATES = new Set(["LIVE", "CRIT"]);
const DEAD_SCHEDULE_STATES = new Set(["PPD", "CNCL", "SUSP"]);
// An unfinished game this far in the past is treated as never played, so a
// silently postponed game cannot freeze the cup forever.
const STALE_MS = 36 * 60 * 60 * 1000;

export function isFinal(game) {
  return FINAL_STATES.has(game.state) && game.awayScore != null && game.homeScore != null;
}

function emptyPlayerStats() {
  // `lastHeld` is the number of cup games played when the player last held
  // the cup: 0 for the start of the season, null for never.
  return { points: 0, defenses: 0, captures: 0, longestStreak: 0, bestTeamWins: 0, lastHeld: null };
}

export function computeCup({ games, owners, startingHolder, now = Date.now() }) {
  const ownerOf = (team) => owners[team] ?? null;

  const byTeam = new Map();
  const playable = games
    .filter((game) => !DEAD_SCHEDULE_STATES.has(game.scheduleState))
    .map((game) => ({ ...game, time: Date.parse(game.startTime) }))
    .sort((a, b) => a.time - b.time || a.id - b.id);
  for (const game of playable) {
    for (const team of [game.away, game.home]) {
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(game);
    }
  }

  const playerStats = {};
  const teamStats = {};
  for (const [team, playerId] of Object.entries(owners)) {
    playerStats[playerId] ??= emptyPlayerStats();
    teamStats[team] = { points: 0 };
  }

  const history = [];
  let holder = startingHolder;
  let cursor = -Infinity;
  let streak = 0;
  let nextGame = null;
  // The run of cup games won in a row by one player, across all their teams.
  let winRun = 0;
  let winRunBy = null;
  if (ownerOf(holder) != null) playerStats[ownerOf(holder)].lastHeld = 0;

  const challengerOf = (game) => (game.away === holder ? game.home : game.away);
  // Two undrafted teams playing each other has nothing to do with the bet.
  const concernsTheBet = (game) => ownerOf(holder) != null || ownerOf(challengerOf(game)) != null;

  for (;;) {
    const game = (byTeam.get(holder) ?? []).find(
      (candidate) => candidate.time > cursor && concernsTheBet(candidate),
    );
    if (!game) break;

    const challenger = challengerOf(game);
    const challengerOwner = ownerOf(challenger);

    if (!isFinal(game)) {
      if (now - game.time > STALE_MS) {
        cursor = game.time;
        continue;
      }
      nextGame = {
        gameId: game.id,
        startTime: game.startTime,
        away: game.away,
        home: game.home,
        live: LIVE_STATES.has(game.state),
        challenger,
        challengerOwner,
      };
      break;
    }
    if (game.awayScore === game.homeScore) break; // Never happens in the NHL; bad data.

    const winner = game.awayScore > game.homeScore ? game.away : game.home;
    const owner = ownerOf(holder);
    const held = winner === holder;
    const changedHands = !held && challengerOwner != null;
    // Who scores: the owner of the winner, or null if nobody drafted the winner.
    const pointTo = ownerOf(winner);

    streak += 1;
    winRun = pointTo === winRunBy ? winRun + 1 : 1;
    winRunBy = pointTo;
    if (pointTo != null) {
      const stats = playerStats[pointTo];
      stats.points += 1;
      teamStats[winner].points += 1;
      stats.longestStreak = Math.max(stats.longestStreak, winRun);
      stats.bestTeamWins = Math.max(stats.bestTeamWins, teamStats[winner].points);
    }
    if (held && owner != null) playerStats[owner].defenses += 1;
    if (changedHands && challengerOwner !== owner) playerStats[challengerOwner].captures += 1;

    history.push({
      gameId: game.id,
      startTime: game.startTime,
      away: game.away,
      home: game.home,
      awayScore: game.awayScore,
      homeScore: game.homeScore,
      lastPeriodType: game.lastPeriodType ?? null,
      holder,
      challenger,
      winner,
      owner,
      challengerOwner,
      pointTo,
      changedHands,
    });

    if (changedHands) {
      holder = winner;
      streak = 0;
    }
    if (ownerOf(holder) != null) playerStats[ownerOf(holder)].lastHeld = history.length;
    cursor = game.time;
  }

  return {
    holder,
    holderOwner: ownerOf(holder),
    streak,
    nextGame,
    history,
    playerStats,
    teamStats,
  };
}

// What decides the rank, most important first: points, then the tie-breakers.
const RANK_KEYS = [
  (row) => row.points,
  (row) => row.longestStreak,
  (row) => row.bestTeamWins,
  (row) => row.lastHeld ?? -1,
];

function compareRank(a, b) {
  for (const key of RANK_KEYS) {
    const difference = key(b) - key(a);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Leaderboard rows. Players share a rank only if every tie-breaker is level
// too. Captures and names merely order the rows inside such a tie.
export function rankPlayers(players, playerStats) {
  return players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      ...emptyPlayerStats(),
      ...playerStats[player.id],
    }))
    .sort((a, b) => compareRank(a, b) || b.captures - a.captures || a.name.localeCompare(b.name))
    .map((row, index, rows) => ({
      rank: rows.findIndex((other) => compareRank(other, row) === 0) + 1,
      ...row,
    }));
}
