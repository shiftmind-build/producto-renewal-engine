import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Convencion de desarrollo: el emulador de Firestore usa el 8080 (lo dice
// firebase.json) y el backend el 8090. Compartir puerto los mata a los dos.
// El proxy evita CORS en desarrollo y hace que el codigo hable siempre de rutas
// relativas: en produccion apunta al Cloud Run con VITE_API y no cambia nada mas.
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, proxy: { '/panel': 'http://localhost:8090', '/mi': 'http://localhost:8090' } },
})
