import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
