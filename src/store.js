// One small reactive store shared by all components. The server always
// answers with the full state, so every action simply replaces it.

import { computed, reactive, watch } from "vue";

const PASSCODE_KEY = "cup.passcode";
const PLAYER_KEY = "cup.player";

function read(key) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private windows may block storage; the value then lasts for this visit only.
  }
}

export const store = reactive({
  data: null,
  loadError: null,
  busy: false,
  notice: null,
  passcode: read(PASSCODE_KEY),
  // Name of the player using this device. Chosen by the player, on trust.
  myName: read(PLAYER_KEY),
  // Profile pictures as data URLs, by player name.
  avatars: {},
  avatarsEnabled: false,
});

export const league = computed(() => store.data?.league ?? null);
export const isCommish = computed(() => store.data?.viewer.role === "commish");
export const cup = computed(() => store.data?.cup ?? null);

export const playersById = computed(() =>
  Object.fromEntries((league.value?.players ?? []).map((player) => [player.id, player])),
);

export const teamsByAbbr = computed(() =>
  Object.fromEntries((store.data?.teams ?? []).map((team) => [team.abbr, team])),
);

export const ownerByTeam = computed(() =>
  Object.fromEntries((league.value?.picks ?? []).map((pick) => [pick.team, pick.playerId])),
);

// Names a visitor can identify as: the drafted league, or the planned names
// while the league is not set up yet. The commissioner's name is reserved for
// whoever logged in with the commissioner password.
export const knownNames = computed(() => {
  const players = league.value?.players ?? [];
  const names = players.length > 0 ? players.map((player) => player.name) : (store.data?.config.players ?? []);
  if (isCommish.value) return names;
  return names.filter((name) => name !== store.data?.config.commissioner);
});

export const needsIdentity = computed(
  () => store.data != null && !knownNames.value.includes(store.myName),
);

export const me = computed(
  () => league.value?.players.find((player) => player.name === store.myName) ?? null,
);

// Undrafted teams have no owner.
export function playerName(playerId) {
  return playersById.value[playerId]?.name ?? "Not drafted";
}

export function teamName(abbr) {
  return teamsByAbbr.value[abbr]?.name ?? abbr;
}

let noticeTimer = null;
export function notify(text, kind = "info") {
  store.notice = { text, kind };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (store.notice = null), 5000);
}

async function call(path, { method = "GET", body, passcode = store.passcode } = {}) {
  const headers = { "x-league-passcode": passcode };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON answers are reported through the status below.
  }
  if (!response.ok) {
    const error = new Error(payload?.error ?? `The server answered ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

// The state only carries a version of the pictures. The pictures themselves
// are fetched when that version changes, not on every poll.
watch(
  () => store.data?.avatarsVersion,
  async (version) => {
    store.avatarsEnabled = version != null;
    if (version == null) return;
    try {
      store.avatars = (await call("/api/avatars")).avatars;
    } catch {
      // Pictures are decoration. The next change of version tries again.
    }
  },
);

export function logOut() {
  store.passcode = "";
  store.data = null;
  store.avatars = {};
  store.loadError = null;
  write(PASSCODE_KEY, "");
}

// Returns an error message, or null when the password was accepted.
export async function logIn(passcode) {
  try {
    store.data = await call("/api/state", { passcode });
  } catch (error) {
    return error.status === 401 ? "That password is not right." : error.message;
  }
  store.passcode = passcode;
  store.loadError = null;
  write(PASSCODE_KEY, passcode);
  if (isCommish.value) choosePlayer(store.data.config.commissioner);
  return null;
}

export function choosePlayer(name) {
  store.myName = name;
  write(PLAYER_KEY, name);
}

export async function refresh() {
  if (!store.passcode) return;
  try {
    store.data = await call("/api/state");
    store.loadError = null;
  } catch (error) {
    if (error.status === 401) logOut();
    else store.loadError = error.message;
  }
}

// Runs a change on the server. Returns true when it went through.
export async function act(path, body = {}) {
  if (store.busy) return false;
  store.busy = true;
  try {
    store.data = await call(path, { method: "POST", body });
    return true;
  } catch (error) {
    if (error.status === 401) {
      logOut();
      return false;
    }
    notify(error.message, "error");
    if (error.status === 409) await refresh();
    return false;
  } finally {
    store.busy = false;
  }
}
