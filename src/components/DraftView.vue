<script setup>
import { computed, ref, watch } from "vue";
import TeamLogo from "./TeamLogo.vue";
import PlayerAvatar from "./PlayerAvatar.vue";
import AvatarEditor from "./AvatarEditor.vue";
import { act, league, me, notify, ownerByTeam, playerName, store, teamName } from "../store.js";

const config = computed(() => store.data.config);
const names = ref([]);
const selected = ref(null);

// Watches the status alone, so polling does not wipe names being typed.
watch(
  () => league.value.status,
  (status) => {
    if (status !== "setup") return;
    names.value = Array.from({ length: config.value.playerCount }, (_, i) => config.value.players[i] ?? "");
  },
  { immediate: true },
);

// A pick made on another device can take the team selected here.
watch(ownerByTeam, (owners) => {
  if (selected.value && owners[selected.value] != null) selected.value = null;
});

const onTheClock = computed(() => league.value.onTheClock);
const myTurn = computed(() => onTheClock.value != null && onTheClock.value.playerId === me.value?.id);

watch(myTurn, (mine) => {
  if (!mine) selected.value = null;
});

const rounds = computed(() => {
  const playerCount = league.value.players.length;
  const result = [];
  for (let round = 1; round <= config.value.teamsPerPlayer; round++) {
    const slots = [];
    for (let i = 1; i <= playerCount; i++) {
      const pickNumber = (round - 1) * playerCount + i;
      const pick = league.value.picks.find((entry) => entry.pickNumber === pickNumber);
      const position = round % 2 === 0 ? playerCount - i : i - 1;
      slots.push({ pickNumber, pick, playerId: league.value.players[position].id });
    }
    result.push({ round, slots });
  }
  return result;
});

async function start() {
  if (await act("/api/setup", { players: names.value })) notify("Draft order drawn. Good luck!");
}

async function confirmPick() {
  const team = selected.value;
  if (!team || !myTurn.value) return;
  const { pickNumber, playerId } = onTheClock.value;
  if (await act("/api/pick", { team, pickNumber, playerId })) {
    notify(`You picked ${teamName(team)}.`);
  }
  selected.value = null;
}
</script>

<template>
  <section v-if="league.status === 'setup'" class="card">
    <h1>Set up the league</h1>
    <p class="muted">
      {{ config.playerCount }} players draft {{ config.teamsPerPlayer }} teams each. The draft order is drawn at random
      and the picks run as a snake: the order turns around after every round.
    </p>
    <form class="setup" @submit.prevent="start">
      <label v-for="(_, index) in names" :key="index" class="field">
        <span>Player {{ index + 1 }}</span>
        <input v-model="names[index]" type="text" maxlength="24" required autocomplete="off" />
      </label>
      <button type="submit" class="button primary" :disabled="store.busy">Draw order and start the draft</button>
    </form>
  </section>

  <template v-else>
    <section class="card clock" :class="{ waiting: !myTurn }">
      <p class="eyebrow">
        Round {{ onTheClock.round }} · Pick {{ onTheClock.pickNumber }} of {{ league.totalPicks }}
      </p>
      <h1 class="with-avatar">
        <PlayerAvatar :name="playerName(onTheClock.playerId)" :size="44" />
        <template v-if="myTurn">Your turn, {{ me.name }}</template>
        <template v-else>{{ playerName(onTheClock.playerId) }} is on the clock</template>
      </h1>
      <p v-if="!myTurn" class="muted">Waiting for the pick. This page updates by itself.</p>
      <div v-else-if="selected" class="confirm">
        <TeamLogo :team="selected" :size="44" />
        <strong>{{ teamName(selected) }}</strong>
        <span class="confirm-actions">
          <button type="button" class="button ghost" @click="selected = null">Cancel</button>
          <button type="button" class="button primary" :disabled="store.busy" @click="confirmPick">
            Confirm pick
          </button>
        </span>
      </div>
      <p v-else class="muted">Choose a team below.</p>
    </section>

    <section class="card">
      <h2>Teams</h2>
      <div class="team-grid">
        <button
          v-for="team in store.data.teams"
          :key="team.abbr"
          type="button"
          class="team-tile"
          :class="{ taken: ownerByTeam[team.abbr] != null, selected: selected === team.abbr, locked: !myTurn }"
          :disabled="!myTurn || ownerByTeam[team.abbr] != null"
          :aria-pressed="selected === team.abbr"
          @click="selected = team.abbr"
        >
          <TeamLogo :team="team.abbr" :size="44" />
          <span class="team-tile-name">{{ team.name }}</span>
          <span v-if="ownerByTeam[team.abbr] != null" class="team-tile-owner">
            {{ playerName(ownerByTeam[team.abbr]) }}
          </span>
          <span v-else-if="team.abbr === config.startingHolder" class="badge gold">Has the cup</span>
        </button>
      </div>
    </section>

    <section class="card">
      <h2>Draft board</h2>
      <div class="board-scroll">
        <table class="table board">
          <tbody>
            <tr v-for="row in rounds" :key="row.round">
              <th scope="row" class="muted">R{{ row.round }}</th>
              <td
                v-for="slot in row.slots"
                :key="slot.pickNumber"
                :class="{ current: onTheClock?.pickNumber === slot.pickNumber, filled: slot.pick }"
              >
                <span class="slot-number muted">{{ slot.pickNumber }}</span>
                <span class="slot-player" :class="{ strong: slot.playerId === me?.id }">
                  <PlayerAvatar :name="playerName(slot.playerId)" :size="20" />
                  {{ playerName(slot.playerId) }}
                </span>
                <span v-if="slot.pick" class="slot-team">
                  <TeamLogo :team="slot.pick.team" :size="24" />
                  {{ slot.pick.team }}
                </span>
                <span v-else class="slot-team muted">–</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <AvatarEditor />
</template>
