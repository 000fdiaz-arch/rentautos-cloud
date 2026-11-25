import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const publicKey = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "";
  let privilegedKey = publicKey.startsWith("sb_secret_");
  try {
    const payload = JSON.parse(Buffer.from(publicKey.split(".")[1] ?? "", "base64url").toString());
    privilegedKey ||= payload.role === "service_role";
  } catch {
    // Publishable keys do not use JWT encoding.
  }
  if (privilegedKey) throw new Error("VITE_SUPABASE_ANON_KEY must be a public Supabase key.");
  return {
  base: "/",
  plugins: [react()],
  // Temporary release copies are not app entry points. Scanning/watching them
  // can keep the local server busy before it can serve the first page.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    port: 5174,
    watch: { ignored: ["**/.tmp/**", "**/tmp/**", "**/artifacts/**", "**/sites/**", "**/exports/**"] }
  }
  };
});
