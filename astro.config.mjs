import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import thirdPartyNoticesPlugin from "./scripts/third-party-notices.mjs";

export default defineConfig({
  site: "https://cavwic.github.io",
  base: "/cavwic-solutions-lab",
  output: "static",
  integrations: [react()],
  vite: {
    server: {
      fs: {
        allow: [fileURLToPath(new URL(".", import.meta.url)), realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url)))],
      },
    },
    cacheDir: fileURLToPath(new URL("./.cache/vite", import.meta.url)),
    plugins: [thirdPartyNoticesPlugin({ projectRoot: fileURLToPath(new URL(".", import.meta.url)), failOnMissing: true })],
  },
});
