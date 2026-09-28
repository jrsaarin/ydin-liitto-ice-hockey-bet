<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import StandingsView from "./components/StandingsView.vue";
import DraftView from "./components/DraftView.vue";
import TeamsView from "./components/TeamsView.vue";
import LoginView from "./components/LoginView.vue";
import PlayerPicker from "./components/PlayerPicker.vue";
import AdminPanel from "./components/AdminPanel.vue";
import { choosePlayer, isCommish, league, logOut, needsIdentity, refresh, store } from "./store.js";
import { formatAgo } from "./format.js";

const DRAFT_POLL_MS = 4000;
// Results change once a day, so the scoreboard rarely needs a fresh copy.
const SEASON_POLL_MS = 10 * 60 * 1000;

// The app has two phases: the interactive draft, then a read-only scoreboard.
const drafted = computed(() => league.value?.status === "complete");
const askIdentity = computed(() => !drafted.value && needsIdentity.value);

const now = ref(Date.now());
let timer = null;

async function tick() {
  if (!document.hidden && !store.busy) await refresh();
  now.value = Date.now();
  timer = setTimeout(tick, drafted.value ? SEASON_POLL_MS : DRAFT_POLL_MS);
}

function onVisible() {
  if (document.hidden) return;
  clearTimeout(timer);
  tick();
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisible);
  tick();
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  document.removeEventListener("visibilitychange", onVisible);
});
</script>

<template>
  <main v-if="!store.passcode" class="page narrow">
    <LoginView />
  </main>

  <template v-else>
    <header class="topbar">
      <div class="topbar-inner">
        <span class="brand">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <span>Ydin liitto Cup</span>
        </span>
        <span v-if="store.data" class="badge">{{ drafted ? "Season" : "Draft" }}</span>
      </div>
    </header>

    <main class="page" :class="{ narrow: askIdentity }">
      <p v-if="store.loadError && !store.data" class="banner error">
        Could not load the league. {{ store.loadError }}
      </p>
      <p v-else-if="!store.data" class="muted center">Loading…</p>
      <PlayerPicker v-else-if="askIdentity" />
      <template v-else>
        <p v-if="store.loadError" class="banner error">Connection lost. Showing the last known state.</p>
        <template v-if="drafted">
          <StandingsView />
          <TeamsView />
        </template>
        <DraftView v-else />
        <AdminPanel v-if="isCommish && league.status !== 'setup'" />
      </template>
    </main>

    <footer v-if="store.data" class="footer">
      <span v-if="drafted">
        NHL results updated {{ formatAgo(store.data.sync.lastSyncedAt, now) }}.
        <span v-if="store.data.sync.error" class="error-text">Last update failed: {{ store.data.sync.error }}</span>
      </span>
      <span class="footer-actions">
        <button v-if="!drafted && !needsIdentity" type="button" class="link" @click="choosePlayer('')">
          Playing as {{ store.myName }} · change
        </button>
        <button type="button" class="link" @click="logOut">Log out</button>
      </span>
    </footer>
  </template>

  <p v-if="store.notice" class="toast" :class="store.notice.kind" role="status">{{ store.notice.text }}</p>
</template>
