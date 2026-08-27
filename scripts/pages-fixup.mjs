import { copyFileSync, writeFileSync } from 'node:fs'

// Deep links (/orders, /shift-log) are client-side routes. GitHub Pages has no
// server to rewrite them, but it does serve 404.html for anything it cannot find —
// so an identical copy of index.html there boots the app and the router takes over.
copyFileSync('dist/index.html', 'dist/404.html')

// Without this, Pages runs the output through Jekyll and drops files starting with _.
writeFileSync('dist/.nojekyll', '')

console.log('pages: wrote dist/404.html and dist/.nojekyll')
