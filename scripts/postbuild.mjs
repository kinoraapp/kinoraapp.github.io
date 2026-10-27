// GitHub Pages has no server-side routing. Serving the app shell as 404.html makes deep links
// such as /<repo>/v/<id> or auth callbacks (?code=...) load the single-page app, which then routes them.
import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist");
await copyFile(path.join(dist, "index.html"), path.join(dist, "404.html"));
// Stop GitHub Pages from running Jekyll, which would drop files and folders that start with "_".
await writeFile(path.join(dist, ".nojekyll"), "");
if (process.env.CUSTOM_DOMAIN) {
  await writeFile(path.join(dist, "CNAME"), `${process.env.CUSTOM_DOMAIN.trim()}\n`);
  console.log(`wrote dist/CNAME for ${process.env.CUSTOM_DOMAIN}`);
}
console.log("wrote dist/404.html and dist/.nojekyll");
