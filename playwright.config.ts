import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: { command: "npm run dev:test", url: "http://127.0.0.1:14332/cavwic-solutions-lab/", reuseExistingServer: true },
  use: { baseURL: "http://127.0.0.1:14332/cavwic-solutions-lab/", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "msedge" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "msedge" } }
  ]
});
