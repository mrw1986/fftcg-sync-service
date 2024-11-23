<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useDateFormat, useLocalStorage } from '@vueuse/core'
import { getAuth } from 'firebase/auth'

interface ApiEndpoint {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  description: string
  params?: Parameter[]
  responses: ApiResponse[]
  example?: {
    request?: string
    response?: string
  }
  authenticated: boolean
  tags?: string[]
}

interface Parameter {
  name: string
  type: string
  required: boolean
  description: string
  default?: string
  validation?: {
    pattern?: string
    min?: number
    max?: number
  }
}

interface ApiResponse {
  status: number
  description: string
  schema: string
}

interface ResponseState {
  loading: boolean
  data: any
  error: string | null
  headers: Record<string, string>
  status: number
  timestamp: number
}

interface RequestHeader {
  key: string
  value: string
  enabled: boolean
}

interface HistoryEntry {
  id: string
  endpoint: string
  method: string
  params: Record<string, any>
  headers: RequestHeader[]
  timestamp: number
  status: number
  success: boolean
}

const endpoints: ApiEndpoint[] = [
  {
    name: 'List Cards',
    method: 'GET',
    path: '/api/cards',  // Updated path to include /api prefix
    description: 'Retrieve a list of all cards with optional filtering',
    authenticated: false,
    params: [
      {
        name: 'groupId',
        type: 'string',
        required: false,
        description: 'Filter by specific group ID'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Maximum number of cards to return',
        default: '50'
      },
      {
        name: 'offset',
        type: 'number',
        required: false,
        description: 'Number of cards to skip',
        default: '0'
      }
    ],
    responses: [
      {
        status: 200,
        description: 'List of cards retrieved successfully',
        schema: `{
  "cards": [
    {
      "id": "string",
      "name": "string",
      "groupId": "string",
      "imageUrl": "string",
      "prices": {
        "normal": "number",
        "foil": "number"
      }
    }
  ],
  "total": "number",
  "limit": "number",
  "offset": "number"
}`
      }
    ]
  },
  {
    name: 'Card Details',
    method: 'GET',
    path: '/api/cards/{id}',
    description: 'Get details for a specific card',
    authenticated: false,
    tags: ['cards'],
    params: [
      {
        name: 'id',
        type: 'string',
        required: true,
        description: 'Card ID'
      }
    ],
    responses: [
      {
        status: 200,
        description: 'Card details retrieved successfully',
        schema: `{
  "id": "string",
  "name": "string",
  "groupId": "string",
  "imageUrl": "string",
  "prices": {
    "normal": "number",
    "foil": "number"
  },
  "priceHistory": [
    {
      "date": "string",
      "normal": "number",
      "foil": "number"
    }
  ]
}`
      }
    ]
  },
  {
    name: 'Card Sync',
    method: 'GET',
    path: '/api/testCardSync',
    description: 'Trigger a card synchronization',
    authenticated: true,
    params: [
      {
        name: 'dryRun',
        type: 'boolean',
        required: false,
        description: 'Run sync without making changes',
        default: 'true'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Maximum number of cards to process',
        default: '5'
      }
    ],
    responses: [
      {
        status: 200,
        description: 'Sync initiated successfully',
        schema: `{
  "jobId": "string",
  "status": "string",
  "message": "string"
}`
      }
    ]
  },
  {
    name: 'Price Sync',
    method: 'GET',
    path: '/api/testPriceSync',
    description: 'Trigger a price synchronization',
    authenticated: true,
    params: [
      {
        name: 'dryRun',
        type: 'boolean',
        required: false,
        description: 'Run sync without making changes',
        default: 'false'
      }
    ],
    responses: [
      {
        status: 200,
        description: 'Price sync initiated successfully',
        schema: `{
  "jobId": "string",
  "status": "string",
  "message": "string"
}`
      }
    ]
  },
  {
    name: 'Sync Status',
    method: 'GET',
    path: '/api/syncStatus/{jobId}',
    description: 'Check the status of a sync operation',
    authenticated: true,
    params: [
      {
        name: 'jobId',
        type: 'string',
        required: true,
        description: 'Sync job ID'
      }
    ],
    responses: [
      {
        status: 200,
        description: 'Sync status retrieved successfully',
        schema: `{
  "jobId": "string",
  "status": "string",
  "progress": "number",
  "details": {
    "processed": "number",
    "total": "number",
    "errors": "number"
  }
}`
      }
    ]
  }
]

const BASE_URL = 'https://us-central1-fftcg-sync-service.cloudfunctions.net'
const selectedEndpoint = ref<ApiEndpoint>(endpoints[0])
const showResponse = ref(true)
const showHeaders = ref(false)
const showHistory = ref(false)
const showResponseHeaders = ref(false)
const customHeaders = ref<RequestHeader[]>([
  { key: 'Accept', value: 'application/json', enabled: true }
])
const history = ref<HistoryEntry[]>([])
const selectedTags = ref<string[]>([])
const showAuthenticated = ref(true)
const searchQuery = ref('')

// Response state
const responseState = ref<ResponseState>({
  loading: false,
  data: null,
  error: null,
  headers: {},
  status: 0,
  timestamp: 0
})

const paramValues = ref<Record<string, any>>({})

// Computed properties
const methodColor = computed(() => {
  switch (selectedEndpoint.value.method) {
    case 'GET': return 'var(--vp-c-green)'
    case 'POST': return 'var(--vp-c-brand)'
    case 'PUT': return 'var(--vp-c-yellow)'
    case 'DELETE': return 'var(--vp-c-red)'
    default: return 'var(--vp-c-text-1)'
  }
})

const filteredEndpoints = computed(() => {
  return endpoints.filter(endpoint => {
    const matchesSearch = endpoint.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
                         endpoint.path.toLowerCase().includes(searchQuery.value.toLowerCase())
    const matchesTags = selectedTags.value.length === 0 || 
                       endpoint.tags?.some(tag => selectedTags.value.includes(tag))
    const matchesAuth = showAuthenticated.value || !endpoint.authenticated
    
    return matchesSearch && matchesTags && matchesAuth
  })
})

const formattedDate = computed(() => {
  return (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }
})

// Lifecycle hooks
onMounted(() => {
  const savedHistory = localStorage.getItem('api-explorer-history')
  if (savedHistory) {
    history.value = JSON.parse(savedHistory)
  }
  
  initParamValues(selectedEndpoint.value)
})

// Methods
function initParamValues(endpoint: ApiEndpoint) {
  const values: Record<string, any> = {}
  endpoint.params?.forEach(param => {
    values[param.name] = param.default || ''
  })
  paramValues.value = values
}

function addHeader() {
  customHeaders.value.push({ key: '', value: '', enabled: true })
}

function removeHeader(index: number) {
  customHeaders.value.splice(index, 1)
}

function getEnabledHeaders(): Record<string, string> {
  return customHeaders.value
    .filter(h => h.enabled && h.key.trim() !== '')
    .reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {})
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    // Show success message
  } catch (err) {
    // Show error message
  }
}

function saveAsJson(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function addToHistory(entry: Omit<HistoryEntry, 'id'>) {
  const newEntry: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID()
  }
  history.value.unshift(newEntry)
  if (history.value.length > 50) {
    history.value.pop()
  }
  localStorage.setItem('api-explorer-history', JSON.stringify(history.value))
}

async function replayRequest(historyEntry: HistoryEntry) {
  paramValues.value = { ...historyEntry.params }
  customHeaders.value = [...historyEntry.headers]
  const endpoint = endpoints.find(e => e.path === historyEntry.endpoint)
  if (endpoint) {
    selectedEndpoint.value = endpoint
    await tryEndpoint(endpoint)
  }
}

async function tryEndpoint(endpoint: ApiEndpoint) {
  responseState.value = {
    loading: true,
    data: null,
    error: null,
    headers: {},
    status: 0,
    timestamp: Date.now()
  }

  try {
    const token = await getAuthToken()
    
    if (endpoint.authenticated && !token) {
      throw new Error('Authentication required for this endpoint')
    }

    // Replace path parameters
    let finalPath = endpoint.path
    if (endpoint.params) {
      endpoint.params.forEach(param => {
        if (param.required && !paramValues.value[param.name]) {
          throw new Error(`Required parameter ${param.name} is missing`)
        }
        if (finalPath.includes(`{${param.name}}`)) {
          finalPath = finalPath.replace(
            `{${param.name}}`,
            paramValues.value[param.name] || ''
          )
        }
      })
    }

    // Build URL with query parameters
    const url = new URL(`${BASE_URL}${finalPath}`)
    
    // Add query parameters
    if (endpoint.params) {
      Object.entries(paramValues.value).forEach(([key, value]) => {
        if (value !== '' && !endpoint.path.includes(`{${key}}`)) {
          url.searchParams.append(key, value.toString())
        }
      })
    }

    // Add default parameters for sync endpoints
    if (endpoint.path.includes('Sync')) {
      url.searchParams.set('dryRun', 'true')
      url.searchParams.set('limit', '5')
    }

    const headers = {
      ...getEnabledHeaders(),
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }

    console.log('Making request to:', url.toString())
    console.log('With headers:', headers)

    const response = await fetch(url.toString(), {
      method: endpoint.method,
      headers
    })

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error || errorJson.message || 'Unknown error'
      } catch {
        errorMessage = errorText || `HTTP Error: ${response.status} ${response.statusText}`
      }
      throw new Error(errorMessage)
    }

    const data = await response.json()

    responseState.value = {
      loading: false,
      data,
      error: null,
      headers: responseHeaders,
      status: response.status,
      timestamp: Date.now()
    }

    addToHistory({
      endpoint: endpoint.path,
      method: endpoint.method,
      params: { ...paramValues.value },
      headers: [...customHeaders.value],
      timestamp: Date.now(),
      status: response.status,
      success: true
    })

  } catch (error) {
    console.error('API Error:', error)
    responseState.value = {
      ...responseState.value,
      loading: false,
      error: error instanceof Error ? error.message : 'An error occurred',
      status: error instanceof Error && error.message.includes('Authentication') ? 401 : 500,
      data: null
    }

    addToHistory({
      endpoint: endpoint.path,
      method: endpoint.method,
      params: { ...paramValues.value },
      headers: [...customHeaders.value],
      timestamp: Date.now(),
      status: responseState.value.status,
      success: false
    })
  }
}

async function getAuthToken(): Promise<string | null> {
  const auth = getAuth()
  const user = auth.currentUser
  if (user) {
    try {
      return await user.getIdToken()
    } catch (error) {
      console.error('Error getting auth token:', error)
      return null
    }
  }
  return null
}

// Watch for endpoint changes
watch(selectedEndpoint, (newEndpoint) => {
  initParamValues(newEndpoint)
  responseState.value = {
    loading: false,
    data: null,
    error: null,
    headers: {},
    status: 0,
    timestamp: 0
  }
})
</script>

<template>
  <div class="api-explorer">
    <div class="sidebar">
      <!-- Search and Filter Section -->
      <div class="search-section">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search endpoints..."
          class="search-input"
        />
        <div class="filter-options">
          <!--
          <div class="tags">
            <button
              v-for="tag in ['cards', 'sync']"
              :key="tag"
              class="tag-button"
              :class="{ active: selectedTags.includes(tag) }"
              @click="selectedTags = selectedTags.includes(tag) 
                ? selectedTags.filter(t => t !== tag)
                : [...selectedTags, tag]"
            >
              {{ tag }}
            </button>
          </div>
        -->
          <label class="auth-toggle">
            <input
              type="checkbox"
              v-model="showAuthenticated"
            >
            Show authenticated
          </label>
        </div>
      </div>

      <!-- Endpoint List -->
      <div class="endpoint-list">
        <div
    v-for="endpoint in filteredEndpoints"
    :key="endpoint.path"
    class="endpoint-item"
    :class="{ 
      active: endpoint === selectedEndpoint,
      authenticated: endpoint.authenticated
    }"
    @click="selectedEndpoint = endpoint"
  >
    <div class="endpoint-item-header">
      <span class="name">{{ endpoint.name }}</span>
    </div>
    <div class="endpoint-path">{{ endpoint.path }}</div>
  </div>
      </div>

      <!-- History Section -->
      <div class="history-section">
        <div class="history-toggle" @click="showHistory = !showHistory">
          <span>History</span>
          <span class="toggle-icon">{{ showHistory ? '▼' : '▶' }}</span>
        </div>

        <div v-if="showHistory" class="history-panel">
          <div
            v-for="entry in history"
            :key="entry.id"
            class="history-entry"
            :class="{ 
              'history-success': entry.success,
              'history-error': !entry.success
            }"
            @click="replayRequest(entry)"
          >
            <div class="history-entry-header">
              <span class="history-method">{{ entry.method }}</span>
              <span 
                class="history-status"
                :class="{ 
                  'status-success': entry.status < 400,
                  'status-error': entry.status >= 400
                }"
              >
                {{ entry.status }}
              </span>
            </div>
            <div class="history-endpoint">{{ entry.endpoint }}</div>
            <div class="history-timestamp">
              {{ formattedDate(entry.timestamp) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="content">
      <!-- Endpoint Details -->
      <div class="endpoint-header">
        <div class="endpoint-title">
          <h3>{{ selectedEndpoint.name }}</h3>
          <span 
            v-if="selectedEndpoint.authenticated"
            class="auth-badge"
            title="Requires authentication"
          >
            🔒
          </span>
        </div>
        <div class="endpoint-path">
          <span class="method" :style="{ color: methodColor }">
            {{ selectedEndpoint.method }}
          </span>
          <code>{{ selectedEndpoint.path }}</code>
        </div>
      </div>

      <div class="description">
        {{ selectedEndpoint.description }}
      </div>

      <!-- Tags -->
      <div v-if="selectedEndpoint.tags?.length" class="endpoint-tags">
        <span 
          v-for="tag in selectedEndpoint.tags"
          :key="tag"
          class="tag"
        >
          {{ tag }}
        </span>
      </div>

      <!-- Headers Section -->
      <div class="headers-section">
        <div class="section-header" @click="showHeaders = !showHeaders">
          <h4>Headers</h4>
          <span class="toggle-icon">{{ showHeaders ? '▼' : '▶' }}</span>
        </div>
        <div v-if="showHeaders" class="headers-content">
          <div
            v-for="(header, index) in customHeaders"
            :key="index"
            class="header-input"
          >
            <input
              v-model="header.key"
              placeholder="Header name"
              class="header-key"
            />
            <input
              v-model="header.value"
              placeholder="Header value"
              class="header-value"
            />
            <label class="header-enabled">
              <input type="checkbox" v-model="header.enabled" />
              Enable
            </label>
            <button
              class="remove-header"
              @click="removeHeader(index)"
            >
              ✕
            </button>
          </div>
          <button class="add-header" @click="addHeader">
            Add Header
          </button>
        </div>
      </div>

      <!-- Parameters Section -->
      <template v-if="selectedEndpoint.params?.length">
        <h4>Parameters</h4>
        <div class="params-form">
          <div
            v-for="param in selectedEndpoint.params"
            :key="param.name"
            class="param-input"
          >
            <label :for="param.name">
              {{ param.name }}
              <span v-if="param.required" class="required">*</span>
            </label>
            <input
              :id="param.name"
              v-model="paramValues[param.name]"
              :type="param.type === 'number' ? 'number' : 'text'"
              :placeholder="param.description"
              :required="param.required"
            />
          </div>
          <button
            class="try-button"
            @click="tryEndpoint(selectedEndpoint)"
            :disabled="responseState.loading"
          >
            {{ responseState.loading ? 'Loading...' : 'Try it' }}
          </button>
        </div>
      </template>

      <!-- Response Section -->
      <div 
        v-if="responseState.data || responseState.error" 
        class="live-response"
        :class="{ 'response-error': responseState.error }"
      >
        <div class="response-header">
          <h4>Response</h4>
          <div class="response-actions">
            <button
              class="action-button"
              @click="copyToClipboard(JSON.stringify(responseState.data, null, 2))"
              v-if="responseState.data"
            >
              Copy
            </button>
            <button
              class="action-button"
              @click="saveAsJson(responseState.data, `response-${Date.now()}.json`)"
              v-if="responseState.data"
            >
              Save
            </button>
          </div>
        </div>

        <!-- Response Status and Headers -->
        <div v-if="responseState.status" class="response-status">
          Status: {{ responseState.status }}
        </div>
       
        <div v-if="Object.keys(responseState.headers).length" class="response-headers">
          <div class="section-header" @click="showResponseHeaders = !showResponseHeaders">
            <span>Response Headers</span>
            <span class="toggle-icon">{{ showResponseHeaders ? '▼' : '▶' }}</span>
          </div>
          <div v-if="showResponseHeaders" class="headers-list">
            <div
              v-for="(value, key) in responseState.headers"
              :key="key"
              class="header-item"
            >
              <span class="header-key">{{ key }}:</span>
              <span class="header-value">{{ value }}</span>
            </div>
          </div>
        </div>

        <div v-if="responseState.error" class="error-message">
          {{ responseState.error }}
        </div>
        <pre v-else class="response-data">
          <code>{{ JSON.stringify(responseState.data, null, 2) }}</code>
        </pre>
      </div>

      <!-- Response Schema Section -->
      <h4>Response Schema</h4>
      <div
        v-for="response in selectedEndpoint.responses"
        :key="response.status"
        class="response-section"
      >
        <div class="response-header">
          <span
            class="status"
            :class="response.status < 400 ? 'success' : 'error'"
          >
            {{ response.status }}
          </span>
          <span class="description">{{ response.description }}</span>
        </div>
        <pre class="schema"><code>{{ response.schema }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.api-explorer {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 20px;
  background: var(--custom-api-bg);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  height: 800px;
}

.sidebar {
  background: var(--vp-c-bg-soft);
  padding: 1rem;
  border-right: 1px solid var(--vp-c-divider);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.search-section {
  margin-bottom: 1rem;
  padding: 0.5rem;
}

.search-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  margin-bottom: 0.5rem;
}

.filter-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.tag-button {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  cursor: pointer;
  font-size: 0.8rem;
}

.tag-button.active {
  background: var(--vp-c-brand);
  color: white;
  border-color: var(--vp-c-brand);
}

.auth-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.endpoint-list {
  flex: 1;
  overflow-y: auto;
}

.endpoint-item {
  padding: 0.75rem;
  border-radius: 6px;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.endpoint-item:hover {
  background: var(--vp-c-bg-mute);
}

.endpoint-item.active {
  background: var(--vp-c-brand-dimm);
}

.endpoint-item.authenticated::after {
  content: "🔒";
  float: right;
  font-size: 0.8rem;
}

.endpoint-item-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.endpoint-path {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  word-break: break-all;
}

.history-toggle {
  margin-top: auto;
  padding: 0.75rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--vp-c-bg-mute);
  border-radius: 6px;
  margin-top: 1rem;
}

.history-panel {
  margin-top: 0.5rem;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 0.5rem;
}

.history-entry {
  padding: 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  cursor: pointer;
  background: var(--vp-c-bg-mute);
  border: 1px solid var(--vp-c-divider);
  transition: all 0.2s ease;
}

.history-entry:hover {
  background: var(--vp-c-bg);
}

.history-entry.history-success {
  border-left: 3px solid var(--vp-c-green);
}

.history-entry.history-error {
  border-left: 3px solid var(--vp-c-red);
}

.history-entry-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.history-method {
  font-weight: 600;
}

.history-status {
  font-size: 0.9em;
}

.status-success {
  color: var(--vp-c-green);
}

.status-error {
  color: var(--vp-c-red);
}

.history-endpoint {
  font-size: 0.9em;
  margin-bottom: 0.25rem;
}

.history-timestamp {
  font-size: 0.8em;
  color: var(--vp-c-text-2);
}

.content {
  padding: 1rem;
  overflow-y: auto;
}

.endpoint-header {
  margin-bottom: 1rem;
}

.endpoint-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.auth-badge {
  font-size: 1rem;
  cursor: help;
}

.endpoint-tags {
  display: flex;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.tag {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  background: var(--vp-c-brand-dimm);
  color: var(--vp-c-brand);
  font-size: 0.8rem;
}

.headers-section {
  margin: 1rem 0;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  padding: 0.75rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--vp-c-bg-mute);
}

.headers-content {
  padding: 1rem;
}

.header-input {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  align-items: center;
}

.header-key,
.header-value {
  padding: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  font-size: 0.9em;
}

.header-enabled {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.remove-header {
  padding: 0.25rem 0.5rem;
  background: var(--vp-c-red);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.add-header {
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: var(--vp-c-brand);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  width: 100%;
}

.params-form {
  margin: 1rem 0;
}

.param-input {
  margin-bottom: 1rem;
}

.param-input label {
  display: block;
  margin-bottom: 0.25rem;
}

.param-input input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
}

.required {
  color: var(--vp-c-red);
  margin-left: 0.25rem;
}

.try-button {
  padding: 0.5rem 1rem;
  background: var(--vp-c-brand);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  width: 100%;
}

.try-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.live-response {
  margin: 1rem 0;
  padding: 1rem;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  position: relative;
}

.response-error {
  border-color: var(--vp-c-red);
}

.response-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.response-actions {
  display: flex;
  gap: 0.5rem;
}

.action-button {
  padding: 0.25rem 0.75rem;
  background: var(--vp-c-brand);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9em;
}

.response-headers {
  margin: 1rem 0;
  background: var(--vp-c-bg-soft);
  border-radius: 4px;
}

.headers-list {
  padding: 0.75rem;
}

.header-item {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.9em;
}

.error-message {
  color: var(--vp-c-red);
  padding: 0.75rem;
  border: 1px solid var(--vp-c-red);
  border-radius: 4px;
  margin: 1rem 0;
}

.response-data {
  background: var(--vp-c-bg-mute);
  padding: 1rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 1rem 0;
}

.response-section {
  margin: 1rem 0;
}

.response-section .status {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-weight: 600;
}

.response-section .status.success {
  background: var(--vp-c-green-dimm);
  color: var(--vp-c-green);
}

.response-section .status.error {
  background: var(--vp-c-red-dimm);
  color: var(--vp-c-red);
}

.schema {
  background: var(--vp-c-bg-mute);
  padding: 1rem;
  border-radius: 4px;
  overflow-x: auto;
  margin-top: 0.5rem;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.loading-spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--vp-c-brand);
  border-radius: 50%;
  border-top-color: transparent;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Responsive Design */
@media (max-width: 768px) {
  .api-explorer {
    grid-template-columns: 1fr;
    height: auto;
  }

  .sidebar {
    max-height: 300px;
    overflow-y: auto;
  }

  .content {
    padding: 1rem;
  }

  .header-input {
    grid-template-columns: 1fr;
  }

  .endpoint-item-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .response-header {
    flex-direction: column;
    gap: 0.5rem;
  }

  .response-actions {
    width: 100%;
    justify-content: space-between;
  }

  .action-button {
    flex: 1;
  }
}

/* Dark Mode Adjustments */
:root[class~='dark'] .api-explorer {
  --custom-api-bg: var(--vp-c-bg-soft);
}

:root[class~='dark'] .loading-overlay {
  background: rgba(0, 0, 0, 0.7);
}
</style>