<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

const props = defineProps<{
  root?: string
  initialExpanded?: boolean
}>()

const expandedNodes = ref<Set<string>>(new Set())
const treeData = ref<TreeNode[]>([])

// Process the file structure into a tree
onMounted(async () => {
  // Initial structure based on your codebase
  treeData.value = [
    {
      name: 'functions',
      path: 'functions',
      type: 'directory',
      children: [
        {
          name: 'src',
          path: 'functions/src',
          type: 'directory',
          children: [
            {
              name: 'config',
              path: 'functions/src/config',
              type: 'directory',
              children: [
                {
                  name: 'firebase.ts',
                  path: 'functions/src/config/firebase.ts',
                  type: 'file'
                }
              ]
            },
            {
              name: 'services',
              path: 'functions/src/services',
              type: 'directory',
              children: [
                {
                  name: 'cardSync.ts',
                  path: 'functions/src/services/cardSync.ts',
                  type: 'file'
                },
                {
                  name: 'priceSync.ts',
                  path: 'functions/src/services/priceSync.ts',
                  type: 'file'
                }
              ]
            }
          ]
        }
      ]
    }
  ]

  // If initialExpanded is true, expand all nodes
  if (props.initialExpanded) {
    const expandAll = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.type === 'directory') {
          expandedNodes.value.add(node.path)
          if (node.children) {
            expandAll(node.children)
          }
        }
      })
    }
    expandAll(treeData.value)
  }
})

function toggleNode(path: string) {
  if (expandedNodes.value.has(path)) {
    expandedNodes.value.delete(path)
  } else {
    expandedNodes.value.add(path)
  }
}

const toggleAllNodes = () => {
  if (expandedNodes.value.size > 0) {
    expandedNodes.value.clear()
  } else {
    const expandAll = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (node.type === 'directory') {
          expandedNodes.value.add(node.path)
          if (node.children) {
            expandAll(node.children)
          }
        }
      })
    }
    expandAll(treeData.value)
  }
}
</script>

<template>
  <div class="file-tree">
    <div class="tree-controls">
      <button @click="toggleAllNodes">
        {{ expandedNodes.size > 0 ? 'Collapse All' : 'Expand All' }}
      </button>
    </div>
    <div class="tree-content">
      <template v-for="node in treeData" :key="node.path">
        <div :class="['tree-node', `level-${0}`]">
          <div
            :class="['node-content', node.type]"
            @click="node.children && node.children.length > 0 && toggleNode(node.path)"
          >
            <span
              v-if="node.children && node.children.length > 0"
              :class="['expand-icon', { expanded: expandedNodes.has(node.path) }]"
            >
              {{ expandedNodes.has(node.path) ? '▼' : '▶' }}
            </span>
            <span class="node-name">{{ node.name }}</span>
          </div>
          <div v-if="expandedNodes.has(node.path) && node.children" class="children">
            <template v-for="child in node.children" :key="child.path">
              <div :class="['tree-node', `level-${1}`]">
                <div
                  :class="['node-content', child.type]"
                  @click="child.children && child.children.length > 0 && toggleNode(child.path)"
                >
                  <span
                    v-if="child.children && child.children.length > 0"
                    :class="['expand-icon', { expanded: expandedNodes.has(child.path) }]"
                  >
                    {{ expandedNodes.has(child.path) ? '▼' : '▶' }}
                  </span>
                  <span class="node-name">{{ child.name }}</span>
                </div>
                <div v-if="expandedNodes.has(child.path) && child.children" class="children">
                  <template v-for="grandchild in child.children" :key="grandchild.path">
                    <!-- Add another level if needed -->
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Keep your existing styles */
</style>