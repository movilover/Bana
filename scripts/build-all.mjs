// Builds the User site (root) and the Admin Console (admin/) into ONE folder: dist/ (+ dist/admin/)
// so both are published together on the same GitHub Pages site.
//   User : https://<name>.github.io/<repo>/
//   Admin: https://<name>.github.io/<repo>/admin/
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const run = (cmd, env = {}, cwd = process.cwd()) => execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env, ...env } });
let base = process.env.VITE_BASE_PATH || "/";
if (!base.startsWith("/")) base = "/" + base;
if (!base.endsWith("/")) base += "/";
const adminBase = base + "admin/";

run("npx vite build", {
  VITE_BASE_PATH: base,
  VITE_ADMIN_URL: process.env.VITE_ADMIN_URL || adminBase,
});
run(
  "npx vite build",
  {
    VITE_BASE_PATH: adminBase,
    VITE_USER_SITE_URL: process.env.VITE_USER_SITE_URL || base.replace(/\/$/, ""),
  },
  path.resolve("admin")
);

fs.rmSync("dist/admin", { recursive: true, force: true });
fs.cpSync(path.join("admin", "dist"), path.join("dist", "admin"), { recursive: true });
fs.copyFileSync("dist/index.html", "dist/404.html"); // SPA deep-link fallback for the user site
fs.writeFileSync("dist/.nojekyll", "");
console.log("Combined build ready in dist/ (user site at base " + base + ", admin at " + adminBase + ")");
