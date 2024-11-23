<template>
  <div v-if="!isAuthenticated" class="auth-wrapper">
    <div class="auth-container">
      <h2>FFTCG Sync Service Documentation</h2>
      <p>Authentication required to access documentation.</p>
      <button @click="signIn" class="signin-button">
        Sign in with Google
      </button>
    </div>
  </div>
  <div v-else>
    <div v-if="showTokenUI" class="token-container">
      <div class="token-header">
        <h3>API Token</h3>
        <button @click="toggleTokenUI" class="toggle-button">
          {{ showTokenUI ? 'Hide Token' : 'Show Token' }}
        </button>
      </div>
      <div class="token-content">
        <div class="token-text">{{ token }}</div>
        <button @click="copyToken" class="copy-button">Copy Token</button>
      </div>
      </div>
    <div class="nav-extra">
    <span v-if="userEmail" class="user-email">{{ userEmail }}</span>
    <button @click="signOut" class="logout-button">Sign Out</button>
      </div>
    <slot></slot>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { initializeApp } from 'firebase/app'
import { signOut as firebaseSignOut } from 'firebase/auth'
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged 
} from 'firebase/auth'

const isAuthenticated = ref(false)
const token = ref('')
const showTokenUI = ref(false)
const allowedEmails = ['mrw1986@gmail.com']
const userEmail = ref('')

const firebaseConfig = {
  apiKey: "AIzaSyDJGSxSVXWEmTs9HMzSGu175vpABHuEez0",
  authDomain: "fftcg-sync-service.firebaseapp.com",
  projectId: "fftcg-sync-service",
  storageBucket: "fftcg-sync-service.firebasestorage.app",
  messagingSenderId: "161248420888",
  appId: "1:161248420888:web:61f524b0fa0287017d4f6d"
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const provider = new GoogleAuthProvider()

onMounted(() => {
  onAuthStateChanged(auth, async (user) => {
    isAuthenticated.value = user && allowedEmails.includes(user.email)
    if (user && allowedEmails.includes(user.email)) {
      token.value = await user.getIdToken()
      userEmail.value = user.email || ''
    } else if (user && !allowedEmails.includes(user.email)) {
      await signOut()
      alert('Access denied. Unauthorized email.')
    }
  })
})

const signIn = async () => {
  try {
    const result = await signInWithPopup(auth, provider)
    console.log('Sign in successful:', result) // Debug log
  } catch (error) {
    console.error('Detailed auth error:', error) // More detailed error logging
    if (error.code === 'auth/unauthorized-domain') {
      alert('Authentication failed: Unauthorized domain. Please contact the administrator.')
    } else if (error.code === 'auth/popup-blocked') {
      alert('Authentication failed: Popup was blocked. Please allow popups for this site.')
    } else {
      alert(`Authentication failed: ${error.message}`)
    }
  }
}

const signOut = async () => {
  try {
    await firebaseSignOut(auth)
    isAuthenticated.value = false
    token.value = ''
    userEmail.value = ''
  } catch (error) {
    console.error('Sign out error:', error)
    alert('Error signing out. Please try again.')
  }
}

const toggleTokenUI = () => {
  showTokenUI.value = !showTokenUI.value
}

const copyToken = async () => {
  try {
    await navigator.clipboard.writeText(token.value)
    alert('Token copied to clipboard!')
  } catch (error) {
    console.error('Failed to copy token:', error)
    alert('Failed to copy token. Please try again.')
  }
}

</script>

<style scoped>
.auth-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--vp-c-bg);
}

.auth-container {
  text-align: center;
  padding: 2rem;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  max-width: 400px;
  width: 90%;
}

.signin-button {
  margin-top: 1.5rem;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  background: var(--vp-c-brand);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  transition: background-color 0.2s;
}

.signin-button:hover {
  background: var(--vp-c-brand-dark);
}

.token-container {
  margin: 1rem;
  padding: 1rem;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.token-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.token-header h3 {
  margin: 0;
}

.token-content {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.token-text {
  flex: 1;
  word-break: break-all;
  font-family: monospace;
  background: var(--vp-c-bg);
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.875rem;
}

.copy-button, .toggle-button {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  background: var(--vp-c-brand);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.2s;
}

.copy-button:hover, .toggle-button:hover {
  background: var(--vp-c-brand-dark);
}

.nav-extra {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  position: fixed;
  top: 0.5rem; /* Increased from 0 */
  right: 5rem; /* Increased to make room for GitHub icon */
  z-index: 100;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  font-size: 0.875rem;
}

.user-email {
  color: var(--vp-c-text-2);
  max-width: 200px; /* Limit width */
  overflow: hidden;
  text-overflow: ellipsis; /* Add ellipsis for long emails */
  white-space: nowrap;
}

.logout-button {
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  background: var(--vp-c-danger);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  transition: opacity 0.2s;
  white-space: nowrap; /* Prevent button text from wrapping */
}

.logout-button:hover {
  opacity: 0.9;
}

/* Add responsive styles */
@media (max-width: 768px) {
  .nav-extra {
    position: absolute;
    top: auto;
    right: 1rem;
    padding: 0.25rem 0.5rem;
  }

  .user-email {
    max-width: 150px;
  }
}

h2 {
  color: var(--vp-c-text-1);
  margin-bottom: 1rem;
}

p {
  color: var(--vp-c-text-2);
  margin-bottom: 1rem;
}
</style>