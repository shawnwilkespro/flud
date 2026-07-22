import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    port: 5173,
    // Allow all hosts - needed for Tauri webview
    strictPort: true,
  },
  // Env variables starting with TAURI_ will be available to frontend
  envPrefix: ['VITE_', 'TAURI_'],
})
