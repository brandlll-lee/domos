import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "distribution-notices",
      async closeBundle() {
        const output = fileURLToPath(new URL("./dist", import.meta.url));
        const source = fileURLToPath(new URL("../../deploy", import.meta.url));
        await mkdir(output, { recursive: true });
        await cp(`${source}/NOTICE`, `${output}/NOTICE`);
        await cp(`${source}/licenses`, `${output}/licenses`, {
          recursive: true,
        });
      },
    },
  ],
  server: {
    proxy: {
      "/hosting": "http://127.0.0.1:4310",
      "/rpc": "http://127.0.0.1:4310",
      "/files": "http://127.0.0.1:4310",
    },
  },
});
