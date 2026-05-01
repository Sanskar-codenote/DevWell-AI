import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const targetBrowser = process.env.EXTENSION_BROWSER || 'chrome';
const outDir = path.join(root, targetBrowser === 'firefox' ? 'dist-firefox' : 'dist');

// Load .env if exists
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const appBaseUrl = process.env.APP_BASE_URL;
const apiBaseUrl = process.env.API_BASE_URL;

if (!appBaseUrl || !apiBaseUrl) {
  console.error('Missing required env vars: APP_BASE_URL and API_BASE_URL');
  process.exit(1);
}

const app = new URL(appBaseUrl);
const api = new URL(apiBaseUrl);
if (!['http:', 'https:'].includes(app.protocol) || !['http:', 'https:'].includes(api.protocol)) {
  console.error('APP_BASE_URL and API_BASE_URL must be http/https URLs');
  process.exit(1);
}

const normalizedAppBase = app.origin;
const normalizedApiBase = api.origin;

// Create a more inclusive pattern for content scripts
// If it's localhost, also include 127.0.0.1 automatically
let appUrlPatterns = [`${normalizedAppBase}/*`];
if (normalizedAppBase.includes('localhost')) {
  appUrlPatterns.push(normalizedAppBase.replace('localhost', '127.0.0.1') + '/*');
} else if (normalizedAppBase.includes('127.0.0.1')) {
  appUrlPatterns.push(normalizedAppBase.replace('127.0.0.1', 'localhost') + '/*');
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (
      entry.name === 'dist' || 
      entry.name === 'manifest.template.json' || 
      entry.name === 'scripts_build_extension.mjs' ||
      entry.name === 'chrome-extension' ||
      entry.name === '.env' ||
      entry.name === '.env.example' ||
      entry.name === path.basename(outDir)
    ) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(root, outDir);

// Prepend polyfill to JavaScript files that use chrome APIs
const polyfillCode = `
// WebExtensions polyfill - enables cross-browser compatibility
// Works in both window context (popup/content) and service worker context (background)
const getGlobal = () => {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof window !== 'undefined') return window;
  if (typeof global !== 'undefined') return global;
  if (typeof self !== 'undefined') return self;
  return {};
};
const globalObj = getGlobal();
if (typeof globalObj.browser === 'undefined' && typeof globalObj.chrome !== 'undefined') {
  globalObj.browser = globalObj.chrome;
} else if (typeof globalObj.browser !== 'undefined' && typeof globalObj.chrome === 'undefined') {
  globalObj.chrome = globalObj.browser;
}
`;

const jsFilesToPolyfill = [
  'background.js',
  'content.js',
  'popup.js',
  'monitor.js',
  'guest-analytics.js'
];

const replacements = [
  ['__APP_BASE_URL__', normalizedAppBase],
  ['__API_BASE_URL__', normalizedApiBase],
];

function replaceInFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  
  // Prepend polyfill to extension JavaScript files
  const fileName = path.basename(filePath);
  if (jsFilesToPolyfill.includes(fileName) && !content.startsWith('// WebExtensions polyfill')) {
    // If it has imports at the top, we must put polyfill AFTER them
    const lines = content.split('\n');
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportIndex = i;
      } else if (lines[i].trim() === '' || lines[i].trim().startsWith('//') || lines[i].trim().startsWith('/*')) {
        // Skip whitespace/comments
        continue;
      } else {
        break;
      }
    }
    
    if (lastImportIndex !== -1) {
      const imports = lines.slice(0, lastImportIndex + 1);
      const rest = lines.slice(lastImportIndex + 1);
      content = imports.join('\n') + '\n\n' + polyfillCode + '\n' + rest.join('\n');
    } else {
      content = polyfillCode + content;
    }
  }
  
  fs.writeFileSync(filePath, content);
}

const manifestTemplatePath = path.join(root, 'manifest.template.json');
let manifestContent = fs.readFileSync(manifestTemplatePath, 'utf8');

// Handle multiple patterns in manifest if needed
if (manifestContent.includes('"__APP_URL_PATTERN__"')) {
  manifestContent = manifestContent.replace('"__APP_URL_PATTERN__"', appUrlPatterns.map(p => `"${p}"`).join(', '));
}

for (const [from, to] of replacements) {
  manifestContent = manifestContent.split(from).join(to);
}

const manifest = JSON.parse(manifestContent);

// Firefox-specific Manifest V3 adjustments
if (targetBrowser === 'firefox') {
  if (manifest.background && manifest.background.service_worker) {
    const swScript = manifest.background.service_worker;
    delete manifest.background.service_worker;
    manifest.background.scripts = [swScript];
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Process all JS files
jsFilesToPolyfill.forEach(file => {
  replaceInFile(path.join(outDir, file));
});

console.log(`Extension build complete (${targetBrowser}):`, outDir);
console.log('APP_BASE_URL=', normalizedAppBase);
console.log('API_BASE_URL=', normalizedApiBase);
