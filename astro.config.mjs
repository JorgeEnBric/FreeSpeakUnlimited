import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import basicSsl from '@vitejs/plugin-basic-ssl';

const isDev = process.argv.includes('dev');

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    port: 4321
  },
  build: {
    sourcemap: false
  },
  image: {
    service: { entrypoint: 'astro/assets/services/noop' }
  },
  vite: {
    plugins: isDev ? [basicSsl()] : []
  }
});
