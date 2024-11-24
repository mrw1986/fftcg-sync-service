// .vitepress/components/FileTree.vue

<script setup lang="ts">
import { ref, onMounted, watchEffect, h } from 'vue'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
}

interface FileStructure {
  directories: {
    [key: string]: {
      directories: string[]
      files: string[]
    }
  }
  root_files: string[]
}

const props = defineProps<{
  root?: string
  initialExpanded?: boolean
  fileStructure?: FileStructure | null
}>()

const expandedNodes = ref<Set<string>>(new Set())
const treeData = ref<TreeNode[]>([])
const isLoading = ref(true)
const loadError = ref<string | null>(null)

watchEffect(() => {
  if (props.fileStructure) {
    try {
      isLoading.value = true
      treeData.value = buildTreeFromStructure(props.fileStructure)
      
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
      
      loadError.value = null
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : 'Failed to process file structure'
    } finally {
      isLoading.value = false
    }
  }
})

function buildTreeFromStructure(fileStructure: FileStructure): TreeNode[] {
  const tree: TreeNode[] = []
  
  function createDirectoryStructure(dirPath: string): TreeNode {
    const dirName = dirPath.split('/').pop() || dirPath
    const directory = fileStructure.directories[dirPath]
    if (!directory) {
      throw new Error(`Directory not found: ${dirPath}`)
    }
    const children: TreeNode[] = []

    if (directory.directories) {
      directory.directories.forEach(subDir => {
        children.push(createDirectoryStructure(subDir))
      })
    }

    if (directory.files) {
      directory.files.forEach(file => {
        children.push({
          name: file.split('/').pop() || file,
          path: `${dirPath}/${file}`,
          type: 'file'
        })
      })
    }

    return {
      name: dirName,
      path: dirPath,
      type: 'directory',
      children: children.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })
    }
  }

  Object.keys(fileStructure.directories).forEach(dirPath => {
    if (!dirPath.includes('/')) {
      tree.push(createDirectoryStructure(dirPath))
    }
  })

  if (fileStructure.root_files?.length) {
    tree.push({
      name: 'Root Files',
      path: 'root',
      type: 'directory',
      children: fileStructure.root_files.map(file => ({
        name: file,
        path: file,
        type: 'file'
      })).sort((a, b) => a.name.localeCompare(b.name))
    })
  }

  return tree.sort((a, b) => a.name.localeCompare(b.name))
}

function toggleNode(path: string) {
  if (expandedNodes.value.has(path)) {
    expandedNodes.value.delete(path)
  } else {
    expandedNodes.value.add(path)
  }
}

function getFileIcon(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return '📘'
    case 'js':
    case 'jsx':
      return '📒'
    case 'json':
      return '📋'
    case 'md':
      return '📝'
    case 'env':
      return '🔑'
    case 'rules':
      return '📜'
    default:
      return '📄'
  }
}

const renderTreeNode = (node: TreeNode, level: number = 0) => {
  return h('div',
    {
      class: 'tree-node',
      style: { paddingLeft: `${level * 20}px` }
    },
    [
      h('div',
        {
          class: ['node-content', node.type],
          onClick: () => node.type === 'directory' && toggleNode(node.path)
        },
        [
          node.type === 'directory'
            ? h('span',
                {
                  class: ['expand-icon', { expanded: expandedNodes.value.has(node.path) }]
                },
                expandedNodes.value.has(node.path) ? '📂' : '📁'
              )
            : h('span',
                { class: 'file-icon' },
                getFileIcon(node.name)
              ),
          h('span', { class: 'node-name' }, node.name)
        ]
      ),
      node.type === 'directory' && expandedNodes.value.has(node.path) && node.children
        ? h('div',
            { class: 'children' },
            node.children.map(child => renderTreeNode(child, level + 1))
          )
        : null
    ]
  )
}
</script>

<template>
  <div class="file-tree" role="tree" aria-label="File structure">
    <div v-if="isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <span>Loading file structure...</span>
    </div>

    <div v-else-if="loadError" class="error-state">
      <span class="error-icon">⚠️</span>
      <span>{{ loadError }}</span>
    </div>

    <template v-else>
      <div class="tree-content">
        <template v-for="node in treeData" :key="node.path">
          <component :is="renderTreeNode(node)" />
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.file-tree {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
  font-family: var(--vp-font-family-mono);
  max-height: 800px;
  overflow-y: auto;
}

.tree-content {
  font-size: 0.9rem;
}

.tree-node {
  margin: 0.25rem 0;
}

.node-content {
  display: flex;
  align-items: center;
  padding: 0.25rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s ease;
  user-select: none;
}

.node-content:hover {
  background: var(--vp-c-bg-mute);
}

.node-content.directory {
  font-weight: 500;
}

.expand-icon, .file-icon {
  margin-right: 0.5rem;
  font-size: 1rem;
  width: 1.5rem;
  text-align: center;
}

.node-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.children {
  margin-left: 0.5rem;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--vp-c-text-2);
}

.loading-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--vp-c-brand);
  border-radius: 50%;
  border-top-color: transparent;
  margin-right: 0.5rem;
  animation: spin 1s linear infinite;
}

.error-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--vp-c-danger);
  gap: 0.5rem;
}

.error-icon {
  font-size: 1.2rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .file-tree {
    padding: 0.5rem;
    font-size: 0.9rem;
  }

  .node-content {
    padding: 0.35rem;
  }

  .expand-icon, .file-icon {
    font-size: 0.9rem;
    width: 1.2rem;
  }
}

/* Print styles */
@media print {
  .file-tree {
    border: none;
    max-height: none;
  }

  .node-content {
    break-inside: avoid;
  }
}
</style>