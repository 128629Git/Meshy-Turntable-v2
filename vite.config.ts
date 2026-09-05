import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// npm run build -- --base=/repository-name/ also supports GitHub Pages.
export default defineConfig({ plugins: [react()], base: './' });
