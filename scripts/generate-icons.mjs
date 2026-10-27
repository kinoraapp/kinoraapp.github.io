// Generates the PNG app icons and favicon from the logo. Run with: npm run icons
// Keep the artwork in sync with src/components/Logo.tsx.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const PRIMARY = "#ff6a3d";
const SECONDARY = "#e8336d";

// The mark: two stacked vertical video cards (a nod to the Kinora flip-book viewer) with a play button.
const MARK = `
  <rect x="23" y="12" width="23" height="37" rx="6" fill="#fff" fill-opacity=".42" transform="rotate(12 34.5 30.5)"/>
  <rect x="17" y="14" width="23" height="37" rx="6" fill="#fff" transform="rotate(-6 28.5 32.5)"/>
  <path d="M25.6 26.2c0-1.6 1.8-2.6 3.2-1.7l8.3 5.6c1.2.8 1.2 2.6 0 3.4l-8.3 5.6c-1.4.9-3.2-.1-3.2-1.7z" fill="url(#g)"/>`;

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${PRIMARY}"/><stop offset="1" stop-color="${SECONDARY}"/></linearGradient></defs>`;

const standard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${gradient}
  <rect width="64" height="64" rx="15" fill="url(#g)"/>${MARK}</svg>`;

// Maskable icons need full-bleed artwork with the mark inside the central 80% safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${gradient}
  <rect width="80" height="80" fill="url(#g)"/><g transform="translate(8 8)">${MARK}</g></svg>`;

await mkdir(path.join(root, "public/icons"), { recursive: true });
await writeFile(path.join(root, "public/favicon.svg"), standard.trim() + "\n");
const jobs = [
  [standard, 192, "icon-192.png"],
  [standard, 512, "icon-512.png"],
  [maskable, 180, "apple-touch-icon.png"],
  [maskable, 512, "maskable-512.png"],
];
for (const [svg, size, name] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(root, "public/icons", name));
  console.log(`wrote public/icons/${name}`);
}
