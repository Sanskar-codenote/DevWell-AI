import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const outDir = path.join(root, 'dist');

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
const appUrlPattern = `${normalizedAppBase}/*`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'manifest.template.json' || entry.name === 'scripts_build_extension.mjs') continue;
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

const replacements = [
  ['__APP_BASE_URL__', normalizedAppBase],
  ['__API_BASE_URL__', normalizedApiBase],
  ['__APP_URL_PATTERN__', appUrlPattern],
];

function replaceInFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    content = content.split(from).join(to);
  }
  fs.writeFileSync(filePath, content);
}

const manifestTemplatePath = path.join(root, 'manifest.template.json');
let manifest = fs.readFileSync(manifestTemplatePath, 'utf8');
for (const [from, to] of replacements) {
  manifest = manifest.split(from).join(to);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), manifest);

replaceInFile(path.join(outDir, 'popup.js'));
replaceInFile(path.join(outDir, 'background.js'));

console.log('Extension build complete:', outDir);
console.log('APP_BASE_URL=', normalizedAppBase);
console.log('API_BASE_URL=', normalizedApiBase);
