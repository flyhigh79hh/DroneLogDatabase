import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cesium()],
  optimizeDeps: {
    exclude: ['@mui/material', '@emotion/react', '@emotion/styled'],
    include: ['hoist-non-react-statics', 'prop-types', 'react-is', '@mui/system/colorManipulator', '@mui/system/createStyled', '@mui/system/useThemeWithoutDefault', '@mui/material/utils'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})