<template>
    <button class="theme-toggle" @click="toggleTheme" :title="nextTheme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'">
      <span class="theme-icon">{{ nextTheme === 'dark' ? '🌙' : '☀️' }}</span>
    </button>
  </template>
  
  <script setup>
  import { useData } from 'vitepress'
  import { ref, onMounted } from 'vue'
  
  const { isDark } = useData()
  const nextTheme = ref('dark')
  
  onMounted(() => {
    updateThemeIcon()
  })
  
  function toggleTheme() {
    isDark.value = !isDark.value
    updateThemeIcon()
  }
  
  function updateThemeIcon() {
    nextTheme.value = isDark.value ? 'light' : 'dark'
  }
  </script>
  
  <style scoped>
  .theme-toggle {
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    color: var(--vp-c-text-1);
  }
  
  .theme-icon {
    font-size: 1.2rem;
  }
  </style>