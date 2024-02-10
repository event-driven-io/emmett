import { defineConfig } from 'vitepress';

const env = process.env.NODE_ENV;

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: env === 'production' ? '/emmett/' : '/',
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
        text: 'Examples',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'API Docs', link: '/api-docs' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/event-driven-io/emmett' },
    ],
  },
});
