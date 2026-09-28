// Thin client for the public NHL schedule API. The API sends no CORS
// headers, so it can only be called from the Worker, never from the browser.

const BASE_URL = "https://api-web.nhle.com/v1";

export function normalizeGame(game, gameDate) {
  return {
    id: game.id,
    season: game.season,
    gameType: game.gameType,
    gameDate,
    startTime: game.startTimeUTC,
    state: game.gameState,
    scheduleState: game.gameScheduleState ?? "OK",
    away: game.awayTeam.abbrev,
    home: game.homeTeam.abbrev,
    awayScore: game.awayTeam.score ?? null,
    homeScore: game.homeTeam.score ?? null,
    lastPeriodType: game.gameOutcome?.lastPeriodType ?? null,
  };
}

// Turns one schedule response (seven days starting at the requested date)
// into flat game rows, keeping only the configured season and game types.
export function parseWeek(payload, { season, gameTypes }) {
  const games = [];
  for (const day of payload.gameWeek ?? []) {
    for (const game of day.games ?? []) {
      if (game.season !== season || !gameTypes.includes(game.gameType)) continue;
      games.push(normalizeGame(game, day.date));
    }
  }
  return { games, nextStartDate: payload.nextStartDate ?? null };
}

export async function fetchWeek(date, config, fetcher = fetch) {
  const response = await fetcher(`${BASE_URL}/schedule/${date}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`NHL API answered ${response.status} for week ${date}`);
  return parseWeek(await response.json(), config);
}
