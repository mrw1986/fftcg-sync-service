import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import FileTree from '../components/FileTree.vue'
import ArchitectureDiagram from '../components/ArchitectureDiagram.vue'
import ApiExplorer from '../components/ApiExplorer.vue'
import ProjectStructure from '../components/ProjectStructure.vue'
import LogoutButton from '../components/LogoutButton.vue'
import FirebaseAuth from './FirebaseAuth.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  
  enhanceApp({ app }) {
    app.component('FileTree', FileTree)
    app.component('ArchitectureDiagram', ArchitectureDiagram)
    app.component('ApiExplorer', ApiExplorer)
    app.component('ProjectStructure', ProjectStructure)
  },

  Layout: () => {
    return h(FirebaseAuth, null, {
      default: () => h(DefaultTheme.Layout, null, {
        'nav-bar-content-after': () => h('div', { class: 'nav-controls' }, [
          h('div', { class: 'nav-item' }, [
            h(LogoutButton)
          ])
        ])
      })
    })
  }
} satisfies Theme