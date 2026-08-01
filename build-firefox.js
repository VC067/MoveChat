import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function addDirToZip(zip, dirPath, rootPath = dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await addDirToZip(zip, fullPath, rootPath);
    } else {
      const content = fs.readFileSync(fullPath);
      zip.file(relativePath, content);
    }
  }
}

async function buildFirefox() {
  console.log('[MoveChat Firefox Build] Step 1: Building Vite production package...');
  execSync('npm run build', { stdio: 'inherit', cwd: rootDir });

  const distDir = path.join(rootDir, 'dist');
  const firefoxDistDir = path.join(rootDir, 'dist-firefox');

  console.log('[MoveChat Firefox Build] Step 2: Preparing dist-firefox directory...');
  if (fs.existsSync(firefoxDistDir)) {
    fs.rmSync(firefoxDistDir, { recursive: true, force: true });
  }

  copyDir(distDir, firefoxDistDir);

  console.log('[MoveChat Firefox Build] Step 3: Generating Firefox Manifest V3...');
  const chromeManifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf-8'));

  const firefoxManifest = {
    ...chromeManifest,
    name: "MoveChat: Export & Transfer AI Chats",
    browser_specific_settings: {
      gecko: {
        id: "movechat@vc067.github.io",
        strict_min_version: "109.0",
        data_collection_permissions: {
          required: ["none"]
        }
      },
      gecko_android: {
        strict_min_version: "120.0"
      }
    },
    data_collection_permissions: {
      required: ["none"]
    },
    background: {
      scripts: ["background.js"]
    }
  };

  fs.writeFileSync(
    path.join(firefoxDistDir, 'manifest.json'),
    JSON.stringify(firefoxManifest, null, 2),
    'utf-8'
  );

  console.log('[MoveChat Firefox Build] Step 4: Packaging movechat-firefox-store.zip with JSZip (POSIX forward slashes)...');
  const zip = new JSZip();
  await addDirToZip(zip, firefoxDistDir);

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const zipFile = path.join(rootDir, 'movechat-firefox-store.zip');
  fs.writeFileSync(zipFile, buffer);

  console.log('[MoveChat Firefox Build] ✅ Success! Created Firefox package with POSIX paths:', zipFile);
}

buildFirefox().catch(err => {
  console.error('[MoveChat Firefox Build] ❌ Error:', err);
  process.exit(1);
});
