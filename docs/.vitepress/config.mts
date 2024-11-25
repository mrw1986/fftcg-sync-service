// .vitepress/config.mts

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
      { text: 'Getting Started', link: '/introduction' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'API', link: '/api/' },
      { text: 'Services', link: '/services/card-sync' }
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/introduction' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Performance', link: '/performance' },
          { text: 'Security', link: '/security' }
        ]
      },
      {
        text: 'Setup',
        items: [
          { text: 'Installation', link: '/setup/installation' },
          { text: 'Configuration', link: '/setup/configuration' },
          { text: 'Firebase Config', link: '/setup/firebase-config' }
        ]
      },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/api/' },
          { text: 'Types Reference', link: '/reference/types' }
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
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Deployment Guide', link: '/deployment/' }
        ]
      },
      {
        text: 'Testing',
        items: [
          { text: 'Overview', link: '/testing/' },
          { text: 'Endpoints', link: '/testing/endpoints' },
          { text: 'Images', link: '/testing/images' },
          { text: 'Validation', link: '/testing/validation' }
        ]
      },
      {
        text: 'Monitoring',
        items: [
          { text: 'System Monitoring', link: '/monitoring/' }
        ]
      },
      {
        text: 'Troubleshooting',
        items: [
          { text: 'Overview', link: '/troubleshooting' },
          { text: 'Common Issues', link: '/troubleshooting/common-issues' }
        ]
      },
      {
        text: 'Integrations',
        items: [
          { text: 'TCGplayer', link: '/integrations/tcgplayer' }
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