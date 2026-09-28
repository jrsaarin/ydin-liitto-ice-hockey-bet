<script setup>
import { ref } from "vue";
import { logIn } from "../store.js";

const password = ref("");
const error = ref(null);
const checking = ref(false);

async function submit() {
  checking.value = true;
  error.value = await logIn(password.value.trim());
  checking.value = false;
}
</script>

<template>
  <form class="card gate" @submit.prevent="submit">
    <img src="/favicon.svg" alt="" width="56" height="56" />
    <h1>Ydin liitto Cup</h1>
    <p class="muted">Enter the league password to continue.</p>
    <input v-model="password" type="password" autocomplete="current-password" aria-label="League password" autofocus />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <button type="submit" class="button primary" :disabled="checking || !password.trim()">
      {{ checking ? "Checking…" : "Enter" }}
    </button>
  </form>
</template>
