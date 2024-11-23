<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

interface DiagramNode {
  id: string
  type: 'service' | 'database' | 'function' | 'external'
  label: string
  x: number
  y: number
  width: number
  height: number
}

interface DiagramConnection {
  from: string
  to: string
  label?: string
  type: 'sync' | 'async' | 'storage'
}

const props = defineProps<{
  zoom?: number
  showLabels?: boolean
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const wrapper = ref<HTMLDivElement | null>(null)
const scale = ref(props.zoom || 1)

// Define system components
const nodes: DiagramNode[] = [
  // External Services
  {
    id: 'tcgplayer',
    type: 'external',
    label: 'TCGPlayer API',
    x: 50,
    y: 50,
    width: 120,
    height: 60
  },
  // Firebase Services
  {
    id: 'functions',
    type: 'service',
    label: 'Firebase Functions',
    x: 250,
    y: 150,
    width: 150,
    height: 70
  },
  {
    id: 'firestore',
    type: 'database',
    label: 'Firestore',
    x: 500,
    y: 50,
    width: 120,
    height: 60
  },
  {
    id: 'storage',
    type: 'database',
    label: 'Firebase Storage',
    x: 500,
    y: 250,
    width: 120,
    height: 60
  },
  // Core Functions
  {
    id: 'cardSync',
    type: 'function',
    label: 'Card Sync',
    x: 250,
    y: 50,
    width: 100,
    height: 50
  },
  {
    id: 'priceSync',
    type: 'function',
    label: 'Price Sync',
    x: 250,
    y: 250,
    width: 100,
    height: 50
  },
  {
    id: 'imageProcessor',
    type: 'function',
    label: 'Image Processor',
    x: 250,
    y: 350,
    width: 100,
    height: 50
  }
]

const connections: DiagramConnection[] = [
  // TCGPlayer connections
  {
    from: 'tcgplayer',
    to: 'cardSync',
    label: 'Card Data',
    type: 'sync'
  },
  {
    from: 'tcgplayer',
    to: 'priceSync',
    label: 'Price Data',
    type: 'sync'
  },
  // Function connections
  {
    from: 'cardSync',
    to: 'firestore',
    label: 'Store Cards',
    type: 'storage'
  },
  {
    from: 'priceSync',
    to: 'firestore',
    label: 'Store Prices',
    type: 'storage'
  },
  {
    from: 'imageProcessor',
    to: 'storage',
    label: 'Store Images',
    type: 'storage'
  },
  {
    from: 'cardSync',
    to: 'imageProcessor',
    label: 'Process Images',
    type: 'async'
  }
]

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: DiagramNode
) {
  const x = node.x * scale.value
  const y = node.y * scale.value
  const width = node.width * scale.value
  const height = node.height * scale.value

  ctx.beginPath()
  
  switch (node.type) {
    case 'service':
      ctx.roundRect(x, y, width, height, 10)
      ctx.fillStyle = '#646cff'
      break
    case 'database':
      ctx.ellipse(
        x + width/2,
        y + height/2,
        width/2,
        height/2,
        0,
        0,
        2 * Math.PI
      )
      ctx.fillStyle = '#42b883'
      break
    case 'function':
      ctx.roundRect(x, y, width, height, 5)
      ctx.fillStyle = '#fb923c'
      break
    case 'external':
      ctx.rect(x, y, width, height)
      ctx.fillStyle = '#94a3b8'
      break
  }
  
  ctx.fill()
  ctx.stroke()

  // Draw label
  if (props.showLabels !== false) {
    ctx.fillStyle = '#ffffff'
    ctx.font = `${12 * scale.value}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      node.label,
      x + width/2,
      y + height/2
    )
  }
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  conn: DiagramConnection
) {
  const fromNode = nodes.find(n => n.id === conn.from)
  const toNode = nodes.find(n => n.id === conn.to)
  
  if (!fromNode || !toNode) return

  const start = {
    x: (fromNode.x + fromNode.width/2) * scale.value,
    y: (fromNode.y + fromNode.height/2) * scale.value
  }
  
  const end = {
    x: (toNode.x + toNode.width/2) * scale.value,
    y: (toNode.y + toNode.height/2) * scale.value
  }

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)

  // Draw different line styles based on connection type
  switch (conn.type) {
    case 'sync':
      ctx.setLineDash([])
      ctx.strokeStyle = '#646cff'
      break
    case 'async':
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = '#fb923c'
      break
    case 'storage':
      ctx.setLineDash([])
      ctx.strokeStyle = '#42b883'
      break
  }

  // Draw curved line
  const cp1x = start.x + (end.x - start.x) / 2
  const cp1y = start.y
  const cp2x = cp1x
  const cp2y = end.y
  
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, end.x, end.y)
  ctx.stroke()

  // Draw arrow
  const angle = Math.atan2(end.y - cp2y, end.x - cp2x)
  const arrowLength = 10 * scale.value
  
  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(
    end.x - arrowLength * Math.cos(angle - Math.PI/6),
    end.y - arrowLength * Math.sin(angle - Math.PI/6)
  )
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(
    end.x - arrowLength * Math.cos(angle + Math.PI/6),
    end.y - arrowLength * Math.sin(angle + Math.PI/6)
  )
  ctx.stroke()

  // Draw label if exists
  if (conn.label && props.showLabels !== false) {
    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2 - 10 * scale.value
    
    ctx.font = `${11 * scale.value}px sans-serif`
    ctx.fillStyle = '#64748b'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(conn.label, midX, midY)
  }
}

function draw() {
  if (!canvas.value) return
  
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return

  // Clear canvas
  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)

  // Set line styles
  ctx.lineWidth = 2 * scale.value
  ctx.strokeStyle = '#64748b'

  // Draw connections first (behind nodes)
  connections.forEach(conn => drawConnection(ctx, conn))

  // Draw nodes
  nodes.forEach(node => drawNode(ctx, node))
}

function updateCanvasSize() {
  if (!canvas.value || !wrapper.value) return
  
  const rect = wrapper.value.getBoundingClientRect()
  canvas.value.width = rect.width
  canvas.value.height = rect.height
  draw()
}

// Resize handling
let resizeObserver: ResizeObserver
onMounted(() => {
  if (wrapper.value) {
    resizeObserver = new ResizeObserver(updateCanvasSize)
    resizeObserver.observe(wrapper.value)
  }
  updateCanvasSize()
})

// Watch for prop changes
watch(() => props.zoom, () => {
  scale.value = props.zoom || 1
  draw()
})
</script>

<template>
  <div ref="wrapper" class="architecture-diagram">
    <canvas ref="canvas"></canvas>
    <div class="legend">
      <div class="legend-item">
        <div class="color-box service"></div>
        <span>Firebase Services</span>
      </div>
      <div class="legend-item">
        <div class="color-box database"></div>
        <span>Databases</span>
      </div>
      <div class="legend-item">
        <div class="color-box function"></div>
        <span>Functions</span>
      </div>
      <div class="legend-item">
        <div class="color-box external"></div>
        <span>External Services</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.architecture-diagram {
  position: relative;
  width: 100%;
  height: 500px;
  background: var(--custom-diagram-bg);
  border-radius: 8px;
  overflow: hidden;
}

canvas {
  width: 100%;
  height: 100%;
}

.legend {
  position: absolute;
  bottom: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.9);
  padding: 10px;
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.legend-item {
  display: flex;
  align-items: center;
  margin: 5px 0;
}

.color-box {
  width: 16px;
  height: 16px;
  margin-right: 8px;
  border-radius: 3px;
}

.color-box.service {
  background: #646cff;
}

.color-box.database {
  background: #42b883;
}

.color-box.function {
  background: #fb923c;
}

.color-box.external {
  background: #94a3b8;
}

/* Dark mode adjustments */
:deep(.dark) .legend {
  background: rgba(0, 0, 0, 0.8);
}
</style>