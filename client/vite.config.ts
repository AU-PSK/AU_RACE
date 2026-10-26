import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/AU_RACE/" : "/",
  server: {
    port: 5173,
    strictPort: true,
  },
});
