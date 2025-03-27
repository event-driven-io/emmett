import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import YouTubeEmbed from '../components/YouTubeEmbed.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('YouTubeEmbed', YouTubeEmbed);
  },
} satisfies Theme;
