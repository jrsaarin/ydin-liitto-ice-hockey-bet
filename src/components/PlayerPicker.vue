<script setup>
import { choosePlayer, knownNames } from "../store.js";
</script>

<template>
  <section class="card gate">
    <h1>Who are you?</h1>
    <p class="muted">Choose your own name. You make the picks for this player.</p>
    <div class="name-list">
      <button v-for="name in knownNames" :key="name" type="button" class="button ghost" @click="choosePlayer(name)">
        {{ name }}
      </button>
    </div>
  </section>
</template>
