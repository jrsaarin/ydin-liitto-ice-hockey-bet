<script setup>
import { computed, ref } from "vue";
import TeamLogo from "./TeamLogo.vue";
import PlayerAvatar from "./PlayerAvatar.vue";
import { cup, me, playerName, teamName } from "../store.js";
import { formatDate, formatDateTime, periodSuffix } from "../format.js";

const HISTORY_PREVIEW = 10;
const showAll = ref(false);

const history = computed(() => [...cup.value.history].reverse());
const visibleHistory = computed(() =>
  showAll.value ? history.value : history.value.slice(0, HISTORY_PREVIEW),
);

const winners = computed(() =>
  cup.value.standings.filter((row) => row.rank === 1).map((row) => row.name),
);

const outOfPlay = computed(() => cup.value.holderOwner == null);

const streakText = computed(() => {
  const streak = cup.value.streak;
  if (outOfPlay.value) return "Nobody scores until a drafted team beats it";
  if (history.value.length === 0) return "Holds the cup at the start of the season";
  if (streak === 0) return "Just took the cup";
  return streak === 1 ? "1 cup game since taking it" : `${streak} cup games since taking it`;
});

function ownerIn(game, team) {
  return playerName(team === cup.value.holder ? cup.value.holderOwner : game.challengerOwner);
}

// One line per cup game, told from the point of view of the bet.
function resultText(game) {
  const owner = playerName(game.owner);
  if (game.changedHands) {
    if (game.owner == null) return `${playerName(game.challengerOwner)} won the cup from undrafted ${game.holder}`;
    return game.owner === game.challengerOwner
      ? `${owner} kept it with ${game.winner}`
      : `${playerName(game.challengerOwner)} took the cup from ${owner}`;
  }
  if (game.owner == null) return `Undrafted ${game.holder} kept the cup`;
  if (game.winner === game.holder) return `${owner} defended`;
  return `${owner} lost to undrafted ${game.winner}: cup stays, no point`;
}

function resultKind(game) {
  if (game.changedHands) return "changed";
  return game.pointTo == null ? "idle" : "";
}
</script>

<template>
  <section v-if="cup.finished" class="card winner">
    <p class="eyebrow">Regular season over</p>
    <h1>{{ winners.length === 1 ? "Winner" : "Shared win" }}: {{ winners.join(" and ") }}</h1>
  </section>

  <section class="card">
    <h1>{{ cup.finished ? "Final standings" : "Standings" }}</h1>
    <table class="table standings">
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Player</th>
          <th class="num">Points</th>
          <th class="num extra" title="Games won as cup holder">Defended</th>
          <th class="num extra" title="Times the cup was taken from another player">Taken</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in cup.standings" :key="row.playerId" :class="{ leader: row.rank === 1 && row.points > 0 }">
          <td class="num">{{ row.rank }}</td>
          <td class="player-cell" :class="{ strong: row.playerId === me?.id }">
            <PlayerAvatar :name="row.name" :size="36" />
            {{ row.name }}
            <span v-if="row.playerId === cup.holderOwner" class="badge gold" title="Holds the cup now">Cup</span>
          </td>
          <td class="num points">{{ row.points }}</td>
          <td class="num extra">{{ row.defenses }}</td>
          <td class="num extra">{{ row.captures }}</td>
        </tr>
      </tbody>
    </table>
    <p class="hint">
      One point for every cup game won, whether defending the cup or taking it. Undrafted teams cannot take the
      cup or score. Most points wins.
    </p>
  </section>

  <div class="pair">
    <section class="hero card" :class="{ idle: outOfPlay }">
      <TeamLogo :team="cup.holder" :size="84" />
      <div>
        <p class="eyebrow">{{ cup.finished ? "Ended the season with the cup" : "Cup holder" }}</p>
        <h2>{{ teamName(cup.holder) }}</h2>
        <p class="hero-owner">{{ outOfPlay ? "Out of play" : playerName(cup.holderOwner) }}</p>
        <p class="muted">{{ streakText }}</p>
      </div>
    </section>

    <section v-if="!cup.finished" class="card">
      <p class="eyebrow">
        Next cup game
        <span v-if="cup.nextGame?.live" class="badge live">Live</span>
      </p>
      <div v-if="cup.nextGame" class="matchup">
        <div class="matchup-team">
          <TeamLogo :team="cup.nextGame.away" :size="48" />
          <strong>{{ cup.nextGame.away }}</strong>
          <span class="muted">{{ ownerIn(cup.nextGame, cup.nextGame.away) }}</span>
        </div>
        <div class="matchup-middle">
          <span class="at">at</span>
          <span class="muted small">{{ formatDateTime(cup.nextGame.startTime) }}</span>
        </div>
        <div class="matchup-team">
          <TeamLogo :team="cup.nextGame.home" :size="48" />
          <strong>{{ cup.nextGame.home }}</strong>
          <span class="muted">{{ ownerIn(cup.nextGame, cup.nextGame.home) }}</span>
        </div>
      </div>
      <p v-else class="muted">No upcoming cup game is scheduled.</p>
    </section>
  </div>

  <section class="card">
    <h2>Cup games</h2>
    <p v-if="history.length === 0" class="muted">No cup games have been played yet.</p>
    <ol v-else class="games">
      <li v-for="game in visibleHistory" :key="game.gameId" class="game">
        <span class="game-date muted">{{ formatDate(game.startTime) }}</span>
        <span class="game-score">
          <TeamLogo :team="game.away" :size="28" />
          <span :class="{ strong: game.winner === game.away }">{{ game.away }} {{ game.awayScore }}</span>
          <span class="muted">–</span>
          <span :class="{ strong: game.winner === game.home }">{{ game.homeScore }} {{ game.home }}</span>
          <TeamLogo :team="game.home" :size="28" />
          <span v-if="periodSuffix(game.lastPeriodType)" class="muted small">{{ periodSuffix(game.lastPeriodType) }}</span>
        </span>
        <span class="game-result" :class="resultKind(game)">{{ resultText(game) }}</span>
      </li>
    </ol>
    <button v-if="history.length > HISTORY_PREVIEW" type="button" class="link" @click="showAll = !showAll">
      {{ showAll ? "Show fewer" : `Show all ${history.length} games` }}
    </button>
  </section>
</template>
