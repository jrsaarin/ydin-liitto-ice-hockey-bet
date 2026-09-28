<script setup>
import { computed, ref, watch } from "vue";
import { store } from "../store.js";

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 32 },
});

const stored = computed(() => store.avatars[props.name] ?? null);
// A picture the browser cannot show falls back to the initials.
const broken = ref(false);
watch(stored, () => (broken.value = false));
const image = computed(() => (broken.value ? null : stored.value));

// Shown until a picture is set: "Herra Tossavainen" becomes HT, "Paltsi" becomes PA.
const initials = computed(() => {
  const words = props.name.trim().split(/\s+/);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : props.name.slice(0, 2);
  return letters.toUpperCase();
});

// Each name gets its own steady colour.
const hue = computed(() => [...props.name].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 360, 7));

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.4)}px`,
  "--hue": hue.value,
}));
</script>

<template>
  <span class="avatar" :class="{ empty: !image }" :style="style" aria-hidden="true">
    <img v-if="image" :src="image" alt="" :width="size" :height="size" @error="broken = true" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
