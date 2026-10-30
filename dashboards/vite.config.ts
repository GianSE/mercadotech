import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: instalável e funcionando sem internet. O site já embarca a Gold e
    // consulta no navegador; falta só guardar os arquivos. Tudo o que é do
    // próprio site (app, dados, extensão de Parquet, mapas) entra no cache na
    // instalação; o motor do DuckDB, que vem do jsDelivr, no primeiro uso.
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
        background_color: "#f4f4f1",
        theme_color: "#0b0c0f",
        icons: [
          { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icone-mascara-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json,parquet,wasm}"],
        // Os maiores arquivos do site: o cubo do CAGED (~5 MB) e a extensão
        // de Parquet do DuckDB (~3 MB).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Os dados são pedidos com ?v=<data da Gold>. No cache, vale o arquivo:
        // um deploy com dado novo troca a revisão dele e o cache se renova.
        ignoreURLParametersMatching: [/^v$/],
        navigateFallback: "/index.html",
        // Na instalação, o service worker assume a página já aberta: sem isso,
        // a primeira visita inteira passaria por fora dele.
        clientsClaim: true,
        runtimeCaching: [
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
        ],
      },
    }),
  ],
  // O DuckDB-WASM carrega o próprio worker e o .wasm do CDN em tempo de
  // execução; pré-empacotá-lo no dev só atrapalha.
  optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  build: {
    // O chunk do ECharts (~650 kB, ~217 kB gzip) já vem só com os gráficos
    // usados; ele fica em cache entre deploys, então o aviso padrão não ajuda.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Bibliotecas grandes em arquivos próprios: mudam pouco e ficam em cache
        // entre deploys, enquanto o código das seções muda a cada versão.
        manualChunks(id) {
          if (/node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return "echarts";
          if (id.includes("@duckdb")) return "duckdb";
        },
      },
    },
  },
});
