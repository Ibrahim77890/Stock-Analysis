import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Headers for the built app (`npm run preview` and any static host). The dev server needs inline scripts for hot reload, so it only gets the simple ones.
const SIMPLE = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
  "connect-src 'self' http://127.0.0.1:3000 http://localhost:3000; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, headers: SIMPLE },
  preview: { host: "127.0.0.1", port: 4173, headers: { ...SIMPLE, "Content-Security-Policy": CSP } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    css: true,
  },
});
