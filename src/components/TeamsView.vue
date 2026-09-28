<script setup>
import { computed } from "vue";
import TeamLogo from "./TeamLogo.vue";
import { cup, league, me, ownerByTeam, store, teamName } from "../store.js";

const undrafted = computed(() =>
  store.data.teams.filter((team) => ownerByTeam.value[team.abbr] == null),
);

function heldBy(team) {
  return cup.value.teamStats[team]?.points ?? 0;
}

function points(count) {
  return count === 1 ? "1 point" : `${count} points`;
}

function heldByPlayer(player) {
  return player.teams.reduce((sum, team) => sum + heldBy(team), 0);
}
</script>

<template>
  <div class="rosters">
    <section v-for="player in league.players" :key="player.id" class="card roster" :class="{ mine: player.id === me?.id }">
      <h2>
        {{ player.name }}
        <span class="badge">{{ points(heldByPlayer(player)) }}</span>
      </h2>
      <ul class="roster-teams">
        <li v-for="team in player.teams" :key="team" :class="{ holder: cup.holder === team }">
          <TeamLogo :team="team" :size="36" />
          <span class="roster-name">{{ teamName(team) }}</span>
          <span v-if="cup.holder === team" class="badge gold">Cup</span>
          <span class="muted num">{{ heldBy(team) }}</span>
        </li>
      </ul>
    </section>
  </div>

  <section class="card">
    <h2>Not drafted</h2>
    <p class="hint">These teams cannot take the cup. If one beats the cup holder, the cup stays and nobody scores.</p>
    <ul class="chips">
      <li v-for="team in undrafted" :key="team.abbr" class="chip" :class="{ holder: cup.holder === team.abbr }">
        <TeamLogo :team="team.abbr" :size="24" />
        {{ team.name }}
        <span v-if="cup.holder === team.abbr" class="badge gold">Cup</span>
      </li>
    </ul>
  </section>
</template>
