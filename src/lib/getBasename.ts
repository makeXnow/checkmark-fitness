/**
 * Detects the base path dynamically for React Router.
 * This allows the app to work at any URL path (/, /my-app/, etc.)
 * making it "spin-off ready" - deployable anywhere without config changes.
 * 
 * Usage with React Router:
 * ```tsx
 * import { BrowserRouter } from 'react-router-dom';
 * import { getBasename } from './lib/getBasename';
 * 
 * <BrowserRouter basename={getBasename()}>
 *   <App />
 * </BrowserRouter>
 * ```
 */
export function getBasename(): string {
  // Check if we're running under a subpath by looking at the script src
  const scripts = document.getElementsByTagName('script');
  for (const script of scripts) {
    const src = script.src;
    if (src && src.includes('/assets/')) {
      // Extract the base path from the script URL
      // e.g., "https://makexnow.com/my-app/assets/index.js" -> "/my-app"
      try {
        const url = new URL(src);
        const assetsIndex = url.pathname.indexOf('/assets/');
        if (assetsIndex > 0) {
          const basePath = url.pathname.substring(0, assetsIndex);
          return basePath || '/';
        }
      } catch {
        // Invalid URL, continue to next script
      }
    }
  }
  
  // Fallback: use the BASE_URL from Vite (works for standalone deployments)
  const baseUrl = import.meta.env.BASE_URL;
  if (baseUrl && baseUrl !== './' && baseUrl !== '/') {
    return baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }
  
  return '/';
}
