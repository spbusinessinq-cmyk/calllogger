# EdgeOne Deployment — Pacific Systems Call Logger

## Settings

| Setting | Value |
|---|---|
| Framework | Vite |
| Root directory | `/` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist/public` |

## Notes

- Fully client-side static app — no backend or server required.
- All data is stored in the browser's `localStorage`.
- The `public/_redirects` file enables SPA routing so deep links work correctly.
- No environment variables are required for the build.
