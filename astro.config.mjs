import { defineConfig } from 'astro/config';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  server: {
    port: 4321
  },
  vite: {
    plugins: [basicSsl()]
  }
});
