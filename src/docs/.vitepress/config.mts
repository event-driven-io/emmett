import { defineConfig } from 'vitepress';

const env = process.env.NODE_ENV;

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: env === 'production' ? '/emmett/' : '/',
  lang: 'en-GB',
  title: 'Emmett',
  description: 'Event Sourcing made simple',
  // Add this Vite configuration
  vite: {
    vue: {
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.includes('-'),
        },
      },
    },
  },

  themeConfig: {
    logo: '/logo.png',
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      {
        text: 'Guides',
        items: [
          { text: 'Projections', link: '/guides/projections' },
          { text: 'Testing', link: '/guides/testing' },
          { text: 'Error Handling', link: '/guides/error-handling' },
          { text: 'Workflows', link: '/guides/workflows' },
          { text: 'Choosing an Event Store', link: '/guides/choosing-event-store' },
        ],
      },
      {
        text: 'Event Stores',
        items: [
          { text: 'Overview', link: '/event-stores/' },
          { text: 'PostgreSQL', link: '/event-stores/postgresql' },
          { text: 'EventStoreDB', link: '/event-stores/esdb' },
          { text: 'MongoDB', link: '/event-stores/mongodb' },
          { text: 'SQLite', link: '/event-stores/sqlite' },
        ],
      },
      {
        text: 'Resources',
        items: [
          { text: 'Samples', link: '/samples/' },
          { text: 'Articles', link: '/resources/articles' },
          { text: 'Packages', link: '/resources/packages' },
          { text: 'FAQ', link: '/resources/faq' },
          { text: 'Contributing', link: '/resources/contributing' },
        ],
      },
      { text: 'Discord', link: 'https://discord.gg/fTpqUTMmVa' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/overview' },
          { text: 'Quick Intro', link: '/quick-intro' },
          { text: 'Getting Started', link: '/getting-started' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Projections', link: '/guides/projections' },
          { text: 'Testing', link: '/guides/testing' },
          { text: 'Error Handling', link: '/guides/error-handling' },
          { text: 'Workflows', link: '/guides/workflows' },
          { text: 'Choosing an Event Store', link: '/guides/choosing-event-store' },
        ],
      },
      {
        text: 'Event Stores',
        items: [
          { text: 'Overview', link: '/event-stores/' },
          { text: 'PostgreSQL', link: '/event-stores/postgresql' },
          { text: 'EventStoreDB', link: '/event-stores/esdb' },
          { text: 'MongoDB', link: '/event-stores/mongodb' },
          { text: 'SQLite', link: '/event-stores/sqlite' },
        ],
      },
      {
        text: 'Web Frameworks',
        items: [
          { text: 'Express.js', link: '/frameworks/expressjs' },
          { text: 'Fastify', link: '/frameworks/fastify' },
        ],
      },
      {
        text: 'API Reference',
        link: '/api-reference/',
        items: [
          { text: 'Event', link: '/api-reference/event' },
          { text: 'Command', link: '/api-reference/command' },
          { text: 'Event Store', link: '/api-reference/eventstore' },
          { text: 'Command Handler', link: '/api-reference/commandhandler' },
          { text: 'Decider', link: '/api-reference/decider' },
          { text: 'Projections', link: '/api-reference/projections' },
          { text: 'Workflows', link: '/api-reference/workflows' },
        ],
      },
      {
        text: 'Resources',
        items: [
          { text: 'Samples', link: '/samples/' },
          { text: 'Blog Articles', link: '/resources/articles' },
          { text: 'Packages', link: '/resources/packages' },
          { text: 'FAQ', link: '/resources/faq' },
          { text: 'Contributing', link: '/resources/contributing' },
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
      { icon: 'discord', link: 'https://discord.gg/fTpqUTMmVa' },
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
