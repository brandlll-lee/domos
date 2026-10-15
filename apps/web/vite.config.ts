import { defineConfig } from "vite";

export default defineConfig({
  server: { proxy: { "/rpc": "http://127.0.0.1:4310" } },
});
