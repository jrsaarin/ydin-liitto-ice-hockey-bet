<script setup>
// Shown to the commissioner only. The server enforces the same rule.
import { act, league, notify, playerName, store, teamName } from "../store.js";

async function undo() {
  const last = league.value.picks.at(-1);
  if (!last) return;
  if (!confirm(`Undo pick ${last.pickNumber}: ${teamName(last.team)} for ${playerName(last.playerId)}?`)) return;
  if (await act("/api/undo")) notify("Pick undone.");
}

async function reset() {
  if (!confirm("Delete all players and picks and start over? This cannot be undone.")) return;
  if (await act("/api/reset")) notify("League reset.");
}

async function sync() {
  if (await act("/api/sync")) notify("Results updated.");
}
</script>

<template>
  <details class="card admin">
    <summary>Fix a mistake <span class="badge gold">Commissioner</span></summary>
    <div class="admin-actions">
      <button type="button" class="button ghost" :disabled="store.busy || league.picks.length === 0" @click="undo">
        Undo last pick
      </button>
      <button type="button" class="button ghost" :disabled="store.busy" @click="sync">Update results now</button>
      <button type="button" class="button danger" :disabled="store.busy" @click="reset">Reset the league</button>
    </div>
  </details>
</template>
