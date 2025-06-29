import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

export default defineConfig({
  css:{
    transformer:"lightningcss"
  },
  build:{
    cssMinify:"lightningcss"
  },
  plugins: [cloudflare(), ssrPlugin()]
})
