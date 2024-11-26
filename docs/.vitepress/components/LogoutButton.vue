<script setup lang="ts">
import { ref } from 'vue'
import { signOut } from 'firebase/auth'
import { auth } from '../theme/firebase'

const isLoading = ref(false)

const handleLogout = async () => {
  isLoading.value = true
  
  try {
    await signOut(auth)
    // Clear any auth state
    localStorage.removeItem('firebase:authUser:' + auth.config.apiKey + ':' + auth.name)
    sessionStorage.clear()
    
    // Force a complete reload
    window.location.replace('/')
  } catch (error) {
    console.error('Logout failed:', error)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <button 
    class="nav-icon-button" 
    @click="handleLogout"
    :disabled="isLoading"
    title="Logout"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      class="icon"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14l5-5l-5-5m5 5H9" />
    </svg>
  </button>
</template>

<style scoped>
.nav-icon-button {
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: transparent;
  border: none;
  color: var(--vp-c-text-2);
  transition: color 0.2s;
  cursor: pointer;
  height: var(--vp-nav-height);
  margin-left: 8px;
}

.nav-icon-button:hover {
  color: var(--vp-c-text-1);
}

.nav-icon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon {
  width: 20px;
  height: 20px;
}
</style>