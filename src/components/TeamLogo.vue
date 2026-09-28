<script setup>
import { teamName } from "../store.js";

defineProps({
  team: { type: String, required: true },
  size: { type: Number, default: 40 },
});

const logo = (team, variant) => `https://assets.nhle.com/logos/nhl/svg/${team}_${variant}.svg`;
</script>

<template>
  <picture class="team-logo" :style="{ width: `${size}px`, height: `${size}px` }">
    <source :srcset="logo(team, 'dark')" media="(prefers-color-scheme: dark)" />
    <img :src="logo(team, 'light')" :alt="teamName(team)" :width="size" :height="size" loading="lazy" />
  </picture>
</template>
