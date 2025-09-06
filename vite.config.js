// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ✅ project pages 必须设置 base 为仓库名
export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/chart-annotation/' : '/',
})
