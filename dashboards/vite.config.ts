import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: instalável e, depois de visitado, abrindo sem internet. O app (JS,
    // CSS, mapa do Brasil) entra no cache na instalação. Os dados não vêm no
    // build: o site os lê do Hugging Face, e cada resposta do Hub fica no
    // cache conforme é usada — uma página já aberta continua abrindo offline.
    VitePWA({
      // Versão nova espera um clique ("Atualizar"): recarregar sozinho
      // derrubaria uma apresentação no meio.
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Mercado de TI no Brasil",
        short_name: "Mercado de TI",
        description: "Emprego formal em tecnologia no Brasil, 2007–2026, a partir dos microdados da RAIS e do CAGED.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#eeece6",
        theme_color: "#001229",
        icons: [
          { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icone-mascara-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,woff2}"],
        // O maior arquivo do app é o chunk do ECharts (~1 MB).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html",
        // Na instalação, o service worker assume a página já aberta: sem isso,
        // a primeira visita inteira passaria por fora dele.
        clientsClaim: true,
        runtimeCaching: [
          {
            // Os tiles do OpenStreetMap do mapa da seção Onde, só os que o mapa
            // pede (nunca baixados em lote, como pede a política de uso do OSM)
            // e por uma semana.
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // As tabelas da gold, pelo commit de cada uma (ver lib/dados.ts):
            // o endereço muda quando a tabela muda, então o que está em cache
            // nunca fica velho.
            urlPattern: /^https:\/\/huggingface\.co\/datasets\/[^/]+\/[^/]+\/resolve\//,
            handler: "CacheFirst",
            options: {
              cacheName: "hf-tabelas",
              // ~35 tabelas da gold do TCC, com folga para as versões antigas.
              expiration: { maxEntries: 120, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // A lista das tabelas da gold e o commit de cada uma: pela
            // rede, para ver dado novo assim que publicado; do cache só sem
            // internet (ou com a rede travada).
            urlPattern: /^https:\/\/huggingface\.co\/api\/datasets\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "hf-listagens",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // O motor do DuckDB (worker e .wasm, ~35 MB) vem do jsDelivr com a
            // versão no endereço: o que está em cache nunca fica velho.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@duckdb\//,
            handler: "CacheFirst",
            options: {
              cacheName: "duckdb-motor",
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Extensões que o DuckDB baixe sob demanda, também por versão.
            urlPattern: /^https:\/\/extensions\.duckdb\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "duckdb-extensoes",
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
