const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sourceHtmlPath = '01_Client_Pitch_Presentation3.html';
const outDir = 'pitch_presentation_pack';
const assetsDir = path.join(outDir, 'assets');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir);
}
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir);
}

let html = fs.readFileSync(sourceHtmlPath, 'utf8');

// Regular expression to match src attributes in img tags
const srcRegex = /<img[^>]+src="([^"]+)"/g;
let match;
let count = 0;

while ((match = srcRegex.exec(html)) !== null) {
  const originalPath = match[1];
  // If it's an absolute path
  if (originalPath.startsWith('/')) {
    const filename = path.basename(originalPath);
    const newPath = path.join(assetsDir, filename);
    
    if (fs.existsSync(originalPath)) {
      fs.copyFileSync(originalPath, newPath);
      html = html.replace(originalPath, 'assets/' + filename);
      console.log(`Copied: ${filename}`);
      count++;
    } else {
      console.warn(`File not found: ${originalPath}`);
    }
  }
}

const outHtmlPath = path.join(outDir, 'index.html');
fs.writeFileSync(outHtmlPath, html);
console.log(`Saved updated HTML to ${outHtmlPath}`);
console.log(`Total images copied: ${count}`);

try {
  execSync('zip -r pitch_presentation_pack.zip pitch_presentation_pack', { stdio: 'inherit' });
  console.log('Created archive: pitch_presentation_pack.zip');
} catch (e) {
  console.error('Error creating zip archive:', e);
}
