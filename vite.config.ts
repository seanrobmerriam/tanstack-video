import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tailwindcss from '@tailwindcss/vite'

import { tanstackStart } from '@tanstack/solid-start/plugin/vite'

import solidPlugin from 'vite-plugin-solid'
import { nitro } from 'nitro/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // bun:sqlite is a native Bun binding; it must never be bundled, in dev or
  // in the Nitro production build, only ever left as an external import.
  ssr: { external: ['bun:sqlite'] },
  build: { rollupOptions: { external: ['bun:sqlite'] } },
  plugins: [
    devtools(),
    nitro(),
    tailwindcss(),
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
})
