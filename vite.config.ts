import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { brand } from "./src/config/brand";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // "/" for local dev or a custom domain, "/<repo>/" for a GitHub Pages project site.
  let base = env.VITE_BASE_PATH || "/";
  if (!base.startsWith("/")) base = `/${base}`;
  if (!base.endsWith("/")) base = `${base}/`;
  const name = env.VITE_APP_NAME || brand.name;

  return {
    base,
    plugins: [
      react(),
      {
        name: "app-name-in-html",
        transformIndexHtml: (html) => html.replaceAll("__APP_NAME__", name),
      },
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
        manifest: {
          id: base,
          name,
          short_name: env.VITE_APP_NAME || brand.shortName,
          description: brand.description,
          lang: "en",
          start_url: base,
          scope: base,
          display: "standalone",
          orientation: "portrait",
          theme_color: brand.themeColor,
          background_color: brand.backgroundColor,
          categories: ["entertainment", "social", "video"],
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // Precache only the app shell (code, styles, icons). Supabase API responses,
          // signed video links and thumbnails are never cached by the service worker,
          // so private content and account data are not kept on shared devices.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
          // hls.js is only needed by browsers without native HLS (desktop Chrome, Firefox); load it on demand.
          globIgnores: ["**/hls-*.js"],
          navigateFallback: "index.html",
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 900,
    },
  };
});
