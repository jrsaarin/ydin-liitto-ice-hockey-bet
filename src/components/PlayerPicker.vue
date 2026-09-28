<script setup>
import PlayerAvatar from "./PlayerAvatar.vue";
import { choosePlayer, knownNames } from "../store.js";
</script>

<template>
  <section class="card gate">
    <h1>Who are you?</h1>
    <p class="muted">Choose your own name. You make the picks for this player.</p>
    <div class="name-list">
      <button v-for="name in knownNames" :key="name" type="button" class="button ghost name-choice" @click="choosePlayer(name)">
        <PlayerAvatar :name="name" :size="32" />
        {{ name }}
      </button>
    </div>
  </section>
</template>
