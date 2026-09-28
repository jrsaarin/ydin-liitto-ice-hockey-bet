<script setup>
import { computed, ref } from "vue";
import { act, notify, store } from "../store.js";

const email = ref("");
const notifications = computed(() => store.data.notifications);
const subscribed = computed(() => notifications.value?.subscribed.includes(store.myName) ?? false);

async function subscribe() {
  if (await act("/api/subscription", { name: store.myName, email: email.value.trim() })) {
    notify("Emails are on.");
    email.value = "";
  }
}

async function unsubscribe() {
  if (await act("/api/subscription", { name: store.myName, email: null })) notify("Emails are off.");
}
</script>

<template>
  <section v-if="notifications" class="card">
    <h2>Email notifications</h2>
    <template v-if="subscribed">
      <p class="muted">
        Emails are on for {{ store.myName }}. You get one for every pick and when it is your turn. The address is
        kept private, also from the other players.
      </p>
      <div class="admin-actions">
        <button type="button" class="button ghost" :disabled="store.busy" @click="unsubscribe">Turn off</button>
      </div>
    </template>
    <form v-else class="subscribe" @submit.prevent="subscribe">
      <p class="muted">Get an email for every pick and when it is your turn.</p>
      <input v-model="email" type="email" required maxlength="254" placeholder="you@example.com" aria-label="Email address" autocomplete="email" />
      <button type="submit" class="button primary" :disabled="store.busy || !email.trim()">Turn on</button>
    </form>
  </section>
</template>
