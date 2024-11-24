<script setup>
import { ref, computed } from 'vue'

const props = withDefaults(defineProps(), {
  zoom: 1,
  showLabels: true,
  darkMode: false
})

const hoveredNode = ref(null)
const selectedNode = ref(null)
const zoomLevel = ref(1)
const zoomCenter = ref({ x: 350, y: 200 })

const colorScheme = computed(() => ({
  service: props.darkMode ? '#7582ff' : '#646cff',
  database: props.darkMode ? '#3dd68c' : '#42b883',
  function: props.darkMode ? '#ff9147' : '#fb923c',
  external: props.darkMode ? '#8491a8' : '#94a3b8',
  text: props.darkMode ? '#ffffff' : '#1a1a1a',
  background: props.darkMode ? '#1a1a1a' : '#ffffff',
  hover: 'rgba(255, 255, 255, 0.1)'
}))

const nodes = [
  {
    id: 'tcgplayer',
    type: 'external',
    label: 'TCGPlayer API',
    x: 100,
    y: 100,
    description: 'External TCGPlayer API service',
    details: 'Fetches card data and prices from TCGPlayer marketplace'
  },
  {
    id: 'cardSync',
    type: 'function',
    label: 'Card Sync',
    x: 300,
    y: 100,
    description: 'Card synchronization service',
    details: 'Processes and normalizes card data from TCGPlayer'
  },
  {
    id: 'priceSync',
    type: 'function',
    label: 'Price Sync',
    x: 300,
    y: 200,
    description: 'Price synchronization service',
    details: 'Updates card prices and tracks price history'
  },
  {
    id: 'firestore',
    type: 'database',
    label: 'Firestore',
    x: 500,
    y: 150,
    description: 'Firebase Firestore database',
    details: 'Stores card data, prices, and metadata'
  },
  {
    id: 'imageProcessor',
    type: 'function',
    label: 'Image Processor',
    x: 300,
    y: 300,
    description: 'Image processing service',
    details: 'Optimizes and stores card images'
  },
  {
    id: 'storage',
    type: 'database',
    label: 'Firebase Storage',
    x: 500,
    y: 300,
    description: 'Firebase Storage service',
    details: 'Stores optimized card images'
  }
]

const connections = [
  {
    id: 'conn1',
    from: 'tcgplayer',
    to: 'cardSync',
    type: 'sync',
    label: 'Card Data'
  },
  {
    id: 'conn2',
    from: 'tcgplayer',
    to: 'priceSync',
    type: 'sync',
    label: 'Price Data'
  },
  {
    id: 'conn3',
    from: 'cardSync',
    to: 'firestore',
    type: 'sync',
    label: 'Store Cards'
  },
  {
    id: 'conn4',
    from: 'priceSync',
    to: 'firestore',
    type: 'sync',
    label: 'Store Prices'
  },
  {
    id: 'conn5',
    from: 'imageProcessor',
    to: 'storage',
    type: 'sync',
    label: 'Store Images'
  }
]

const relatedConnections = computed(() => {
  if (!selectedNode.value) return []
  return connections.filter(conn => 
    conn.from === selectedNode.value || conn.to === selectedNode.value
  ).map(conn => conn.id)
})

const relatedNodes = computed(() => {
  if (!selectedNode.value) return []
  return connections
    .filter(conn => conn.from === selectedNode.value || conn.to === selectedNode.value)
    .map(conn => [conn.from, conn.to])
    .flat()
    .filter(nodeId => nodeId !== selectedNode.value)
})

function handleNodeClick(node, event) {
  event.stopPropagation()
  if (selectedNode.value === node.id) {
    resetView()
  } else {
    selectedNode.value = node.id
    zoomToNode(node)
  }
}

function handleCanvasClick() {
  resetView()
}

function zoomToNode(node) {
  zoomLevel.value = 1.5
  zoomCenter.value = { x: node.x, y: node.y }
}

function resetView() {
  zoomLevel.value = 1
  zoomCenter.value = { x: 350, y: 200 }
  selectedNode.value = null
}

function handleNodeHover(nodeId) {
  hoveredNode.value = nodeId
}

function getNodePosition(nodeId) {
  const node = nodes.find(n => n.id === nodeId)
  return node ? { x: node.x, y: node.y } : { x: 0, y: 0 }
}

function getPath(start, end) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const midX = start.x + dx / 2
  
  return `M ${start.x} ${start.y} 
          C ${midX} ${start.y},
            ${midX} ${end.y},
            ${end.x} ${end.y}`
}

function getLabelPosition(fromId, toId) {
  const from = getNodePosition(fromId)
  const to = getNodePosition(toId)
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - 10
  }
}

function getNodeColor(type) {
  return colorScheme.value[type]
}

function getConnectionColor(type) {
  return type === 'async' ? colorScheme.value.function : colorScheme.value.service
}

const transformStyle = computed(() => {
  const x = 350 - (zoomCenter.value.x * zoomLevel.value)
  const y = 200 - (zoomCenter.value.y * zoomLevel.value)
  return `translate(${x}px, ${y}px) scale(${zoomLevel.value})`
})
</script>

<template>
  <div class="diagram-container">
    <button class="zoom-reset" @click="resetView" v-if="zoomLevel > 1">
      Reset View
    </button>
    
    <svg 
      viewBox="0 0 700 400" 
      preserveAspectRatio="xMidYMid meet"
      @click="handleCanvasClick"
    >
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" :stroke="colorScheme.text" stroke-opacity="0.1" />
        </pattern>
      </defs>
      
      <rect width="100%" height="100%" fill="url(#grid)" />

      <g class="diagram" :style="transformStyle">
        <g class="connections">
          <template v-for="conn in connections" :key="conn.id">
            <path
              :d="getPath(getNodePosition(conn.from), getNodePosition(conn.to))"
              :class="[
                'connection',
                conn.type,
                {
                  'connection-highlighted': relatedConnections.includes(conn.id),
                  'connection-dimmed': selectedNode && !relatedConnections.includes(conn.id)
                }
              ]"
              :stroke="getConnectionColor(conn.type)"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="100"
                to="0"
                dur="1.5s"
                repeatCount="indefinite"
              />
            </path>
            <text
              v-if="showLabels"
              :x="getLabelPosition(conn.from, conn.to).x"
              :y="getLabelPosition(conn.from, conn.to).y"
              dy=".3em"
              class="connection-label-outline"
            >
              {{ conn.label }}
            </text>
            <text
              v-if="showLabels"
              :x="getLabelPosition(conn.from, conn.to).x"
              :y="getLabelPosition(conn.from, conn.to).y"
              dy=".3em"
              class="connection-label"
            >
              {{ conn.label }}
            </text>
          </template>
        </g>

        <g class="nodes">
          <template v-for="node in nodes" :key="node.id">
            <g
              :class="[
                'node',
                node.type,
                {
                  'node-hovered': hoveredNode === node.id,
                  'node-selected': selectedNode === node.id,
                  'node-related': relatedNodes.includes(node.id),
                  'node-dimmed': selectedNode && !relatedNodes.includes(node.id) && selectedNode !== node.id
                }
              ]"
              @mouseenter="handleNodeHover(node.id)"
              @mouseleave="handleNodeHover(null)"
              @click="$event => handleNodeClick(node, $event)"
            >
              <rect
                v-if="node.type !== 'database'"
                :x="node.x - 50"
                :y="node.y - 25"
                width="100"
                height="50"
                :rx="node.type === 'function' ? 5 : 0"
                :fill="getNodeColor(node.type)"
              />
              <ellipse
                v-else
                :cx="node.x"
                :cy="node.y"
                rx="50"
                ry="25"
                :fill="getNodeColor(node.type)"
              />
              <text
                :x="node.x"
                :y="node.y"
                dy=".3em"
                class="node-label-outline"
              >
                {{ node.label }}
              </text>
              <text
                :x="node.x"
                :y="node.y"
                dy=".3em"
                class="node-label"
              >
                {{ node.label }}
              </text>
            </g>
          </template>
        </g>
      </g>
    </svg>

    <div v-if="selectedNode" class="details-panel">
      <h3>{{ nodes.find(n => n.id === selectedNode)?.label }}</h3>
      <p>{{ nodes.find(n => n.id === selectedNode)?.details }}</p>
    </div>
  </div>
</template>

<style scoped>
.diagram-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.diagram {
  transform-origin: center;
  transition: transform 0.5s ease;
}

.zoom-reset {
  position: absolute;
  top: 1rem;
  left: 1rem;
  padding: 0.5rem 1rem;
  background: var(--vp-c-brand);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  z-index: 100;
  transition: background-color 0.2s;
}

.zoom-reset:hover {
  background: var(--vp-c-brand-dark);
}

.node {
  cursor: pointer;
  transform-origin: center;
  transition: all 0.2s ease;
}

.node-hovered {
  transform: scale(1.1);
}

.node-selected {
  stroke: var(--vp-c-brand);
  stroke-width: 3px;
}

.node-related {
  stroke: var(--vp-c-brand);
  stroke-width: 2px;
}

.node-dimmed {
  opacity: 0.4;
}

.node .node-label-outline {
  font-size: 12px;
  text-anchor: middle;
  pointer-events: none;
  font-weight: 600;
  fill: transparent;
  stroke: black;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.diagram .nodes .node text.node-label {
  font-size: 12px;
  text-anchor: middle;
  pointer-events: none;
  font-weight: 600;
  fill: white !important;
  stroke: none !important;
}

.node .node-label,
.node:hover .node-label,
.node:active .node-label,
.node.node-selected .node-label,
.node.node-related .node-label,
.node.node-dimmed .node-label {
  fill: white !important;
}

.connection {
  fill: none;
  stroke-width: 2;
  transition: all 0.3s ease;
  opacity: 0.8;
}

.connection.async {
  stroke-dasharray: 5, 5;
}

.connection-highlighted {
  stroke-width: 3;
  opacity: 1;
}

.connection-dimmed {
  opacity: 0.2;
}

.connection-label-outline {
  font-size: 12px;
  text-anchor: middle;
  pointer-events: none;
  transition: all 0.3s ease;
  font-weight: 500;
  fill: transparent;
  stroke: black;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.connection-label {
  font-size: 12px;
  text-anchor: middle;
  pointer-events: none;
  transition: all 0.3s ease;
  font-weight: 500;
  fill: white !important;
}

.label-highlighted {
  font-weight: 600;
}

.label-dimmed {
  opacity: 0.2;
}

.details-panel {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: var(--vp-c-bg-soft);
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  width: 250px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  animation: slideIn 0.2s ease;
}

.details-panel h3 {
  margin: 0 0 0.5rem 0;
  color: var(--vp-c-text-1);
}

.details-panel p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

@keyframes slideIn {
  from {
    transform: translateX(20px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .details-panel {
    position: fixed;
    top: auto;
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
    width: auto;
  }
}
</style>