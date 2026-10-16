import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/hosting": "http://127.0.0.1:4310",
      "/rpc": "http://127.0.0.1:4310",
      "/files": "http://127.0.0.1:4310",
    },
  },
});
