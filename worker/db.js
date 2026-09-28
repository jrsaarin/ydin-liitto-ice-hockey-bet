// All D1 access lives here so the rest of the Worker deals in plain objects.

export async function getMeta(db, key) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

export function setMetaStatement(db, key, value) {
  return db
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, String(value));
}

export async function setMeta(db, key, value) {
  await setMetaStatement(db, key, value).run();
}

export async function deleteMeta(db, key) {
  await db.prepare("DELETE FROM meta WHERE key = ?").bind(key).run();
}

export async function getAllMeta(db) {
  const { results } = await db.prepare("SELECT key, value FROM meta").all();
  return Object.fromEntries(results.map((row) => [row.key, row.value]));
}

export async function getPlayers(db) {
  const { results } = await db
    .prepare("SELECT id, name, draft_position FROM players ORDER BY draft_position")
    .all();
  return results.map((row) => ({ id: row.id, name: row.name, draftPosition: row.draft_position }));
}

export async function getPicks(db) {
  const { results } = await db
    .prepare("SELECT pick_number, player_id, team, picked_at FROM picks ORDER BY pick_number")
    .all();
  return results.map((row) => ({
    pickNumber: row.pick_number,
    playerId: row.player_id,
    team: row.team,
    pickedAt: row.picked_at,
  }));
}

const GAME_COLUMNS =
  "id, season, game_type, game_date, start_time, state, schedule_state, away, home, away_score, home_score, last_period_type";

function rowToGame(row) {
  return {
    id: row.id,
    season: row.season,
    gameType: row.game_type,
    gameDate: row.game_date,
    startTime: row.start_time,
    state: row.state,
    scheduleState: row.schedule_state,
    away: row.away,
    home: row.home,
    awayScore: row.away_score,
    homeScore: row.home_score,
    lastPeriodType: row.last_period_type,
  };
}

export async function getGames(db, season) {
  const { results } = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE season = ? ORDER BY start_time, id`)
    .bind(season)
    .all();
  return results.map(rowToGame);
}

export async function getGamesBetween(db, fromDate, toDate) {
  const { results } = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE game_date >= ? AND game_date <= ?`)
    .bind(fromDate, toDate)
    .all();
  return results.map(rowToGame);
}

export function upsertGameStatement(db, game) {
  return db
    .prepare(
      `INSERT INTO games (${GAME_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         season = excluded.season,
         game_type = excluded.game_type,
         game_date = excluded.game_date,
         start_time = excluded.start_time,
         state = excluded.state,
         schedule_state = excluded.schedule_state,
         away = excluded.away,
         home = excluded.home,
         away_score = excluded.away_score,
         home_score = excluded.home_score,
         last_period_type = excluded.last_period_type`,
    )
    .bind(
      game.id,
      game.season,
      game.gameType,
      game.gameDate,
      game.startTime,
      game.state,
      game.scheduleState,
      game.away,
      game.home,
      game.awayScore,
      game.homeScore,
      game.lastPeriodType,
    );
}
