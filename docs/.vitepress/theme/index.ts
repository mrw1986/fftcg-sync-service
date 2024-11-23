import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import FileTree from '../components/FileTree.vue'
import ArchitectureDiagram from '../components/ArchitectureDiagram.vue'
import ApiExplorer from '../components/ApiExplorer.vue'
import FirebaseAuth from './FirebaseAuth.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  
  enhanceApp({ app }) {
    // Register global components
    app.component('FileTree', FileTree)
    app.component('ArchitectureDiagram', ArchitectureDiagram)
    app.component('ApiExplorer', ApiExplorer)
  },

  Layout: () => {
    return h(FirebaseAuth, null, {
      default: () => h(DefaultTheme.Layout, {
        // Add these props to improve layout
        class: 'docs-container',
        onContent: () => {
          // Recalculate layout when content changes
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'))
          }, 100)
        }
      })
    })
  }
} satisfies Theme