<script setup>
import { computed, ref } from "vue";
import PlayerAvatar from "./PlayerAvatar.vue";
import { act, notify, store } from "../store.js";
import { toAvatar } from "../image.js";

const input = ref(null);
const working = ref(false);
const hasPicture = computed(() => store.avatars[store.myName] != null);

async function chosen(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  working.value = true;
  try {
    const image = await toAvatar(file);
    if (await act("/api/avatar", { name: store.myName, image })) notify("Picture saved.");
  } catch {
    notify("That file could not be read as a picture.", "error");
  } finally {
    working.value = false;
  }
}

async function remove() {
  if (await act("/api/avatar", { name: store.myName, image: null })) notify("Picture removed.");
}
</script>

<template>
  <section v-if="store.avatarsEnabled" class="card avatar-editor">
    <PlayerAvatar :name="store.myName" :size="72" />
    <div>
      <h2>Your picture</h2>
      <p class="muted">Shown next to {{ store.myName }} in the standings.</p>
      <div class="admin-actions">
        <button type="button" class="button ghost" :disabled="working || store.busy" @click="input.click()">
          {{ hasPicture ? "Change picture" : "Choose picture" }}
        </button>
        <button v-if="hasPicture" type="button" class="button ghost" :disabled="working || store.busy" @click="remove">
          Remove
        </button>
      </div>
      <input ref="input" type="file" accept="image/*" hidden @change="chosen" />
    </div>
  </section>
</template>
