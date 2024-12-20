import { defineConfig } from 'vitepress/dist/node/index.js'

export default defineConfig({
  title: 'FFTCG Sync Service',
  description: 'Documentation for the FFTCG Card and Price Sync Service',
  
  // Head tags
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#646cff' }]
  ],

  // Markdown configuration
  markdown: {
    lineNumbers: true,
    theme: 'github-dark'
  },

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'API', link: '/api/' },
      { text: 'Services', link: '/services/card-sync' }, // Changed from '/services/'
      { text: 'Utils', link: '/utils/batch' }  // Changed from '/utils/'
    ],

    sidebar: [
      {
        text: 'Setup',
        items: [
          { text: 'Installation', link: '/setup/installation' },
          { text: 'Configuration', link: '/setup/configuration' }
        ]
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api/' }
        ]
      },
      {
        text: 'Services',
        items: [
          { text: 'Card Sync', link: '/services/card-sync' },
          { text: 'Price Sync', link: '/services/price-sync' }
        ]
      },
      {
        text: 'Utils',
        items: [
          { text: 'Batch Processing', link: '/utils/batch' },
          { text: 'Cache', link: '/utils/cache' },
          { text: 'Error Handling', link: '/utils/error-handling' },
          { text: 'Image Compressor', link: '/utils/image-compressor' },
          { text: 'Image Handler', link: '/utils/image-handler' },
          { text: 'Image Validator', link: '/utils/image-validator' },
          { text: 'Logging', link: '/utils/logging' },
          { text: 'Progress', link: '/utils/progress' },
          { text: 'Request', link: '/utils/request' },
          { text: 'Sync Logger', link: '/utils/sync-logger' }
        ]
      }
    ],

    search: {
      provider: 'local',
      options: {
        detailedView: true
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mrw1986/fftcg-sync-service' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © ${new Date().getFullYear()}`
    },

    outline: {
      level: [2, 3],
      label: 'On this page'
    },

    lastUpdated: {
      text: 'Last updated',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'medium'
      }
    }
  }
})