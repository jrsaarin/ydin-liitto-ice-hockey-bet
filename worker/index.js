import { connect } from "cloudflare:sockets";
import { CONFIG } from "./config.js";
import { TEAMS, TEAM_ABBRS } from "./teams.js";
import { computeCup, rankPlayers } from "./cup.js";
import { describeDraft, shuffle } from "./draft.js";
import { syncGames } from "./sync.js";
import { avatarProblem, avatarsVersion } from "./avatar.js";
import { emailProblem, pickEmails } from "./mail.js";
import { sendMail } from "./smtp.js";
import {
  deleteAvatar,
  deleteMeta,
  deleteSubscription,
  getAllMeta,
  getAvatarIndex,
  getAvatars,
  getGames,
  getMeta,
  getPicks,
  getPlayers,
  getSubscriptions,
  setAvatar,
  setMeta,
  setSubscription,
} from "./db.js";

// The cron trigger syncs once a day. A visit only starts a sync when that run
// is overdue.
const STALE_SYNC_MS = 26 * 60 * 60 * 1000;
const SYNC_LOCK_MS = 2 * 60 * 1000;
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;
const MAX_NAME_LENGTH = 24;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function matches(given, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

// Two passwords, both required before anything is readable. The league
// password makes a "member". The commissioner password makes the "commish",
// who can also undo picks and reset the league. Who is who among the members
// is on trust.
async function requirePasscode(request, env) {
  if (!env.LEAGUE_PASSCODE) throw new HttpError(500, "LEAGUE_PASSCODE is not configured on the server.");
  const given = request.headers.get("x-league-passcode") ?? "";
  if (await matches(given, env.COMMISH_PASSCODE)) return "commish";
  if (await matches(given, env.LEAGUE_PASSCODE)) return "member";
  throw new HttpError(401, "Wrong password.");
}

function requireCommish(role) {
  if (role !== "commish") throw new HttpError(403, "Only the commissioner can do that.");
}

async function requireFairUse(request, env) {
  if (!env.API_LIMITER) return;
  const visitor = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.API_LIMITER.limit({ key: visitor });
  if (!success) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

async function loadLeague(db) {
  const [players, picks] = await Promise.all([getPlayers(db), getPicks(db)]);
  return describeDraft(players, picks, CONFIG.teamsPerPlayer);
}

// The cup result is cached in the meta table. It is rebuilt after every sync
// and thrown away whenever the draft changes.
async function buildCup(db, league) {
  const owners = {};
  for (const pick of league.picks) owners[pick.team] = pick.playerId;
  const games = await getGames(db, CONFIG.season);
  const result = computeCup({ games, owners, startingHolder: CONFIG.startingHolder });
  const today = new Date().toISOString().slice(0, 10);
  const cup = {
    // The race is over when the regular season has ended and the holder has no game left.
    finished: today > CONFIG.seasonEnd && result.nextGame == null,
    holder: result.holder,
    holderOwner: result.holderOwner,
    streak: result.streak,
    nextGame: result.nextGame,
    history: result.history,
    teamStats: result.teamStats,
    standings: rankPlayers(league.players, result.playerStats),
    computedAt: new Date().toISOString(),
  };
  await setMeta(db, "cup_cache", JSON.stringify(cup));
  return cup;
}

async function runSync(env) {
  const db = env.DB;
  await setMeta(db, "sync_started_at", new Date().toISOString());
  try {
    const summary = await syncGames(env);
    const league = await loadLeague(db);
    if (league.status === "complete") await buildCup(db, league);
    return summary;
  } catch (error) {
    await setMeta(db, "last_sync_error", String(error?.message ?? error));
    throw error;
  }
}

// The manual trigger calls the NHL API, so it is throttled even for members.
async function syncOnRequest(env) {
  const last = await getMeta(env.DB, "last_synced_at");
  if (last && Date.now() - Date.parse(last) < MANUAL_SYNC_COOLDOWN_MS) return;
  await runSync(env);
}

function syncIsDue(meta, now = Date.now()) {
  const last = meta.last_synced_at ? Date.parse(meta.last_synced_at) : 0;
  const started = meta.sync_started_at ? Date.parse(meta.sync_started_at) : 0;
  return now - last > STALE_SYNC_MS && now - started > SYNC_LOCK_MS;
}

// Pictures are an extra. If their table is missing, because the code went
// live before its migration, the draft must keep working without them.
async function loadAvatarIndex(db) {
  try {
    return await getAvatarIndex(db);
  } catch (error) {
    console.error("Avatars are unavailable:", error);
    return null;
  }
}

// Emails go out through an ordinary mailbox, by default Gmail. Without an
// account configured, notifications are simply switched off.
function mailAccount(env) {
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) return null;
  return {
    host: env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(env.SMTP_PORT ?? 465),
    secure: env.SMTP_SECURE !== "off",
    user: env.SMTP_USER,
    // Gmail shows app passwords in groups of four. The spaces are not part of it.
    password: env.SMTP_PASSWORD.replaceAll(" ", ""),
    fromName: "Ydin liitto Cup",
  };
}

// Like pictures, notifications are an extra that must never stop the draft.
async function loadSubscriptions(db) {
  try {
    return await getSubscriptions(db);
  } catch (error) {
    console.error("Subscriptions are unavailable:", error);
    return null;
  }
}

// Runs after the pick is stored and answered. Problems are recorded for the
// commissioner and otherwise ignored.
async function notifyPick(env, { pick, league, url }) {
  const account = mailAccount(env);
  const subscriptions = account && (await loadSubscriptions(env.DB));
  if (!subscriptions) return;
  const nameOf = (playerId) => league.players.find((player) => player.id === playerId).name;
  const emails = pickEmails({
    pick,
    picker: nameOf(pick.playerId),
    teamName: TEAMS.find((team) => team.abbr === pick.team).name,
    next: league.onTheClock ? nameOf(league.onTheClock.playerId) : null,
    totalPicks: league.totalPicks,
    subscriptions,
    url,
  });
  if (emails.length === 0) return;
  try {
    await sendMail({ connect, ...account, emails });
    await setMeta(env.DB, "last_mail_error", "");
  } catch (error) {
    console.error("Pick email failed:", error);
    await setMeta(env.DB, "last_mail_error", `${new Date().toISOString()} ${error?.message ?? error}`);
  }
}

async function getState(env, ctx, role) {
  const db = env.DB;
  const [league, meta, avatarIndex, subscriptions] = await Promise.all([
    loadLeague(db),
    getAllMeta(db),
    loadAvatarIndex(db),
    mailAccount(env) ? loadSubscriptions(db) : null,
  ]);

  // Safety net for the cron trigger: a visit refreshes stale data in the background.
  if (syncIsDue(meta)) ctx.waitUntil(runSync(env).catch(() => {}));

  let cup = null;
  if (league.status === "complete") {
    cup = meta.cup_cache ? JSON.parse(meta.cup_cache) : await buildCup(db, league);
  }

  return json({
    viewer: { role },
    config: {
      season: CONFIG.season,
      commissioner: CONFIG.commissioner,
      startingHolder: CONFIG.startingHolder,
      players: CONFIG.players,
      playerCount: CONFIG.playerCount,
      teamsPerPlayer: CONFIG.teamsPerPlayer,
      gameTypes: CONFIG.gameTypes,
    },
    teams: TEAMS,
    league,
    cup,
    // Null means pictures are switched off. Otherwise clients reload the
    // pictures whenever this value changes.
    avatarsVersion: avatarIndex && avatarsVersion(avatarIndex),
    // Null means notifications are switched off. Addresses never leave the
    // server: clients only learn which players are subscribed.
    notifications: subscriptions && {
      subscribed: Object.keys(subscriptions),
      lastError: role === "commish" ? meta.last_mail_error || null : null,
    },
    sync: { lastSyncedAt: meta.last_synced_at ?? null, error: meta.last_sync_error || null },
  });
}

function cleanNames(input) {
  if (!Array.isArray(input)) throw new HttpError(400, "players must be a list of names.");
  const names = input.map((name) => String(name ?? "").trim());
  if (names.length !== CONFIG.playerCount) {
    throw new HttpError(400, `Exactly ${CONFIG.playerCount} players are needed.`);
  }
  if (names.some((name) => !name)) throw new HttpError(400, "Every player needs a name.");
  if (names.some((name) => name.length > MAX_NAME_LENGTH)) {
    throw new HttpError(400, `Names can be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new HttpError(400, "Player names must be different from each other.");
  }
  return names;
}

async function setupLeague(request, env) {
  const db = env.DB;
  const names = cleanNames((await readBody(request)).players);
  if ((await getPlayers(db)).length > 0) {
    throw new HttpError(409, "The league already exists. Reset it first to start over.");
  }
  const order = shuffle(names);
  await db.batch(
    order.map((name, position) =>
      db.prepare("INSERT INTO players (name, draft_position) VALUES (?, ?)").bind(name, position),
    ),
  );
  await deleteMeta(db, "cup_cache");
}

async function makePick(request, env, ctx, role) {
  const db = env.DB;
  const body = await readBody(request);
  const team = String(body.team ?? "").toUpperCase();
  if (!TEAM_ABBRS.has(team)) throw new HttpError(400, "Unknown team.");

  const league = await loadLeague(db);
  if (league.status !== "drafting") throw new HttpError(409, "The draft is not running.");
  const { pickNumber, playerId } = league.onTheClock;
  // The client says which pick it believes it is making, so a stale screen
  // cannot pick on behalf of the next player.
  if (body.pickNumber !== pickNumber) {
    throw new HttpError(409, "The draft has moved on. Refresh and try again.");
  }
  const onTheClock = league.players.find((player) => player.id === playerId).name;
  if (body.playerId !== playerId) {
    throw new HttpError(409, `It is ${onTheClock}'s turn to pick.`);
  }
  if (onTheClock === CONFIG.commissioner && role !== "commish") {
    throw new HttpError(403, `Only the commissioner picks for ${onTheClock}.`);
  }
  if (league.picks.some((pick) => pick.team === team)) {
    throw new HttpError(409, "That team is already taken.");
  }

  try {
    await db
      .prepare("INSERT INTO picks (pick_number, player_id, team, picked_at) VALUES (?, ?, ?, ?)")
      .bind(pickNumber, playerId, team, new Date().toISOString())
      .run();
  } catch {
    throw new HttpError(409, "Someone else picked at the same time. Refresh and try again.");
  }
  await deleteMeta(db, "cup_cache");

  ctx.waitUntil(
    loadLeague(db).then((after) =>
      notifyPick(env, {
        pick: after.picks.find((pick) => pick.pickNumber === pickNumber),
        league: after,
        url: new URL(request.url).origin,
      }),
    ),
  );
}

async function undoPick(env) {
  const db = env.DB;
  const result = await db
    .prepare("DELETE FROM picks WHERE pick_number = (SELECT MAX(pick_number) FROM picks)")
    .run();
  if (!result.meta.changes) throw new HttpError(409, "There is no pick to undo.");
  await deleteMeta(db, "cup_cache");
}

async function resetLeague(env) {
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM picks"),
    db.prepare("DELETE FROM players"),
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'players'"),
    db.prepare("DELETE FROM meta WHERE key = 'cup_cache'"),
  ]);
}

// Names that may carry a picture: the league as drawn, or the planned names
// before the draw.
async function knownNames(db) {
  const players = await getPlayers(db);
  return players.length > 0 ? players.map((player) => player.name) : CONFIG.players;
}

// Sets the picture of one player, or removes it when the image is null. Like
// picks, this is on trust, except for the commissioner's own player.
async function changeAvatar(request, env, role) {
  const db = env.DB;
  const body = await readBody(request);
  const name = String(body.name ?? "");
  if (!(await knownNames(db)).includes(name)) throw new HttpError(400, "Unknown player.");
  if (name === CONFIG.commissioner && role !== "commish") {
    throw new HttpError(403, `Only the commissioner can change the picture of ${name}.`);
  }
  if (body.image == null) {
    await deleteAvatar(db, name);
    return;
  }
  const problem = avatarProblem(body.image);
  if (problem) throw new HttpError(400, problem);
  await setAvatar(db, name, body.image, new Date().toISOString());
}

// Turns pick emails on for one player, or off when the email is null. On
// trust like picks, except for the commissioner's own player.
async function changeSubscription(request, env, role) {
  const db = env.DB;
  if (!mailAccount(env)) throw new HttpError(409, "Notifications are not set up on the server.");
  const body = await readBody(request);
  const name = String(body.name ?? "");
  if (!(await knownNames(db)).includes(name)) throw new HttpError(400, "Unknown player.");
  if (name === CONFIG.commissioner && role !== "commish") {
    throw new HttpError(403, `Only the commissioner can change notifications for ${name}.`);
  }
  if (body.email == null) {
    await deleteSubscription(db, name);
    return;
  }
  const email = String(body.email).trim();
  const problem = emailProblem(email);
  if (problem) throw new HttpError(400, problem);
  await setSubscription(db, name, email, new Date().toISOString());
}

// Lets the commissioner check the mailbox settings without making a pick.
// Unlike pick emails this waits for the mail server, so the answer says
// whether it worked.
async function sendTestEmail(request, env) {
  const account = mailAccount(env);
  if (!account) {
    throw new HttpError(409, "Email is not set up. The SMTP_USER and SMTP_PASSWORD secrets are missing.");
  }
  const subscriptions = (await loadSubscriptions(env.DB)) ?? {};
  const to = subscriptions[CONFIG.commissioner] ?? account.user;
  const text = [
    "This is a test from the commissioner panel.",
    "",
    "If you can read this, pick emails will work too.",
    "",
    new URL(request.url).origin,
  ].join("\n");
  try {
    await sendMail({ connect, ...account, emails: [{ to: [to], subject: "Test email from Ydin liitto Cup", text }] });
    await setMeta(env.DB, "last_mail_error", "");
  } catch (error) {
    const message = String(error?.message ?? error);
    await setMeta(env.DB, "last_mail_error", `${new Date().toISOString()} ${message}`);
    throw new HttpError(502, `The test email failed: ${message}`);
  }
}

async function handleApi(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  // Both checks run before anything touches the database.
  await requireFairUse(request, env);
  const role = await requirePasscode(request, env);

  switch (route) {
    case "GET /api/state":
      break;
    case "GET /api/avatars":
      return json({ avatars: await getAvatars(env.DB) });
    case "POST /api/avatar":
      await changeAvatar(request, env, role);
      break;
    case "POST /api/setup":
      await setupLeague(request, env);
      break;
    case "POST /api/subscription":
      await changeSubscription(request, env, role);
      break;
    case "POST /api/pick":
      await makePick(request, env, ctx, role);
      break;
    case "POST /api/undo":
      requireCommish(role);
      await undoPick(env);
      break;
    case "POST /api/reset":
      requireCommish(role);
      await resetLeague(env);
      break;
    case "POST /api/test-email":
      requireCommish(role);
      await sendTestEmail(request, env);
      break;
    case "POST /api/sync":
      await syncOnRequest(env);
      break;
    default:
      throw new HttpError(404, "Not found.");
  }
  return getState(env, ctx, role);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, ctx);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};
