import fs from 'fs';
import path from 'path';

const assetsDir = path.resolve('public/assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 1x1 transparent PNG base64 string
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const buffer = Buffer.from(pngBase64, 'base64');

['icon16.png', 'icon48.png', 'icon128.png'].forEach(fileName => {
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  console.log(`Created icon placeholder: ${filePath}`);
});
