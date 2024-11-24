// .vitepress/components/ProjectStructure.vue

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { type FileStructure } from '../utils/fileStructureParser'
import FileTree from './FileTree.vue'

const fileStructure = ref<FileStructure | null>(null)
const error = ref<string | null>(null)

// Create structure exactly matching the XML
const simpleStructure: FileStructure = {
  directories: {
    'functions/src/config': {
      directories: [],
      files: ['firebase.ts']
    },
    'functions/src/services': {
      directories: [],
      files: ['cardSync.ts', 'priceSync.ts']
    },
    'functions/src/test': {
      directories: [],
      files: [
        'testEndpoints.ts',
        'testImageHandler.ts',
        'testSync.ts',
        'validateSync.ts'
      ]
    },
    'functions/src/types': {
      directories: [],
      files: [
        'express.d.ts',
        'index.ts',
        'node.d.ts'
      ]
    },
    'functions/src/utils': {
      directories: [],
      files: [
        'batch.ts',
        'cache.ts',
        'error.ts',
        'imageCache.ts',
        'imageCompressor.ts',
        'imageHandler.ts',
        'imageValidator.ts',
        'logger.ts',
        'progress.ts',
        'request.ts',
        'syncLogger.ts'
      ]
    },
    'functions/src': {
      directories: [
        'functions/src/config',
        'functions/src/services',
        'functions/src/test',
        'functions/src/types',
        'functions/src/utils'
      ],
      files: [
        'global.d.ts',
        'index.ts'
      ]
    },
    'functions': {
      directories: ['functions/src'],
      files: []
    }
  },
  root_files: [
    '.env',
    '.env.local',
    '.eslintrc.fix.js',
    '.eslintrc.js',
    '.firebaserc',
    'firebase.json',
    'firestore.indexes.json',
    'firestore.rules',
    'package-lock.json',
    'package.json',
    'storage.rules',
    'tsconfig.json'
  ]
}

onMounted(() => {
  try {
    console.log('Initializing file structure...')
    fileStructure.value = simpleStructure
    console.log('File structure initialized:', fileStructure.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to initialize file structure'
    console.error('Error initializing file structure:', err)
  }
})
</script>

<template>
  <div class="project-structure">
    <div v-if="error" class="error-message">
      {{ error }}
    </div>
    <div v-else-if="!fileStructure" class="loading-message">
      Loading file structure...
    </div>
    <FileTree
      v-else
      :fileStructure="fileStructure"
      :initialExpanded="false"
    />
  </div>
</template>

<style scoped>
.project-structure {
  margin: 2rem 0;
}

.error-message {
  color: var(--vp-c-danger);
  padding: 1rem;
  border: 1px solid currentColor;
  border-radius: 8px;
  margin: 1rem 0;
}

.loading-message {
  color: var(--vp-c-text-2);
  padding: 1rem;
  text-align: center;
  font-style: italic;
}
</style>