import { defineConfig } from 'vitepress';

const env = process.env.NODE_ENV;

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: env === 'production' ? '/emmett/' : '/',
  lang: 'en-GB',
  title: 'Emmett',
  description: 'Event Sourcing made simple',
  themeConfig: {
    logo: '/logo.png',
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
    ],

    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'API Docs', link: '/api-docs' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern:
        'https://github.com/event-driven-io/emmett/edit/master/docs/:path',
      text: 'Suggest changes to this page',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/event-driven-io/emmett' },
    ],
    footer: {
      copyright: 'Copyright © Oskar Dudycz and contributors.',
    },
  },
  head: [
    // ['link', { rel: 'apple-touch-icon', type: 'image/png', size: "180x180", href: '/apple-touch-icon.png' }],
    // ['link', { rel: 'icon', type: 'image/png', size: "32x32", href: '/favicon-32x32.png' }],
    // ['link', { rel: 'icon', type: 'image/png', size: "16x16", href: '/favicon-16x16.png' }],
    // ['link', { rel: 'manifest', manifest: '/manifest.json' }],
    ['meta', { property: 'og:title', content: 'Emmett' }],
    ['meta', { property: 'og:type', content: 'website' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Event Sourcing development made simple',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: 'https://event-driven-io.github.io/emmett/social.png',
      },
    ],
    [
      'meta',
      {
        property: 'og:url',
        content: 'https://event-driven-io.github.io/emmett',
      },
    ],
    ['meta', { property: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { property: 'twitter:site', content: 'marten_lib' }],
    ['meta', { property: 'twitter:creator', content: 'marten_lib' }],
    [
      'meta',
      {
        property: 'twitter:image',
        content: 'https://event-driven-io.github.io/emmett/social.png',
      },
    ],
  ],
});
