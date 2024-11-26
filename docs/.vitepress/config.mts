import { defineConfig } from 'vitepress'
import { getAuth } from 'firebase/auth'
import { app } from './theme/firebase'

// List of public paths that don't require authentication
const PUBLIC_PATHS = ['/', '/index.html', '/index.md']

async function isAuthenticated(): Promise<boolean> {
  // Skip auth check during build
  if (process.env.NODE_ENV === 'production' && process.env.VITEPRESS_BUILD) {
    return true;
  }

  // Skip auth check on server side
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    const auth = getAuth(app);
    return new Promise((resolve) => {
      const unsubscribe = auth.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(!!user);
      });
    });
  } catch (error) {
    console.error('Auth check failed:', error);
    return false;
  }
}

export default defineConfig({
  title: 'FFTCG Sync Service',
  description: 'Documentation for the FFTCG Card and Price Sync Service',
  
  async transformPageData(pageData) {
    const path = '/' + (pageData.relativePath === 'index.md' ? '' : pageData.relativePath)
    
    // Allow access to public paths without authentication
    if (PUBLIC_PATHS.includes(path)) {
      return pageData
    }

    // Skip auth check during build
    if (process.env.NODE_ENV === 'production' && process.env.VITEPRESS_BUILD) {
      return pageData;
    }

    // Check authentication for protected paths
    const authenticated = await isAuthenticated()
    if (!authenticated) {
      return {
        ...pageData,
        frontmatter: {
          ...pageData.frontmatter,
          redirect: '/'
        }
      }
    }

    return pageData
  },

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Introduction', link: '/introduction' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'API', link: '/api/' },
      { text: 'Testing', link: '/testing/' }
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
        text: 'Testing',
        items: [
          { text: 'Overview', link: '/testing/' },
          { text: 'Endpoints', link: '/testing/endpoints' },
          { text: 'Images', link: '/testing/images' },
          { text: 'Validation', link: '/testing/validation' }
        ]
      },
      {
        text: 'Deployment',
        items: [
          { text: 'Deployment Guide', link: '/deployment/' }
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
  },

  vite: {
    define: {
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
    },
    // Add CORS and other security headers
    server: {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'X-XSS-Protection': '1; mode=block'
      }
    }
  }
})