// Pure snake-draft helpers. Pick numbers are 1-based, draft positions 0-based.

export function roundOf(pickNumber, playerCount) {
  return Math.floor((pickNumber - 1) / playerCount) + 1;
}

// Draft position (0-based) that owns the given pick. Odd rounds run
// first-to-last, even rounds run last-to-first.
export function positionForPick(pickNumber, playerCount) {
  const index = (pickNumber - 1) % playerCount;
  const reversed = roundOf(pickNumber, playerCount) % 2 === 0;
  return reversed ? playerCount - 1 - index : index;
}

function cryptoRandomInt(maxExclusive) {
  // Rejection sampling keeps the shuffle unbiased.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

// Fisher-Yates shuffle, returns a new array.
export function shuffle(items, randomInt = cryptoRandomInt) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Builds the draft view of the league from stored players and picks.
export function describeDraft(players, picks, teamsPerPlayer) {
  const ordered = [...players].sort((a, b) => a.draftPosition - b.draftPosition);
  const playerCount = ordered.length;
  const totalPicks = playerCount * teamsPerPlayer;
  const sortedPicks = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);

  let status = "setup";
  if (playerCount > 0) status = sortedPicks.length >= totalPicks ? "complete" : "drafting";

  let onTheClock = null;
  if (status === "drafting") {
    const pickNumber = sortedPicks.length + 1;
    onTheClock = {
      pickNumber,
      round: roundOf(pickNumber, playerCount),
      playerId: ordered[positionForPick(pickNumber, playerCount)].id,
    };
  }

  return {
    status,
    totalPicks,
    onTheClock,
    players: ordered.map((player) => ({
      ...player,
      teams: sortedPicks.filter((pick) => pick.playerId === player.id).map((pick) => pick.team),
    })),
    picks: sortedPicks.map((pick) => ({ ...pick, round: roundOf(pick.pickNumber, playerCount) })),
  };
}
