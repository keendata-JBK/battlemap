import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/battlemap/",
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
  test: {
    exclude: ["services/dingtalk-connector/**", "supabase/functions/**", "node_modules/**", "docs/**"],
  },
  build: {
    outDir: "docs",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        agent: resolve(import.meta.dirname, "agent/index.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("china-map-geojson")) return "map-data";
          if (id.includes("node_modules/zrender")) return "chart-renderer";
          if (id.includes("node_modules/echarts")) return "charts";
          if (id.includes("node_modules/@ant-design/icons")) return "icons";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
});
