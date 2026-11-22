const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const raiz = path.join(__dirname, "..");
const DO_SITE = new Set([
  "index.html", "app.js", "config.js", "data.js", "styles.css", "sw.js", "js", "manifest.webmanifest",
  "logo.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"
]);

test("Pages: só os arquivos do site são servidos; o resto está no exclude do _config.yml", () => {
  const cfg = path.join(raiz, "_config.yml");
  const fora = fs.existsSync(cfg)
    ? fs.readFileSync(cfg, "utf8").split(/\r?\n/).map((l) => (l.match(/^\s+- (\S+)$/) || [])[1]).filter(Boolean)
    : [];
  const entradas = new Set(execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" })
    .trim().split("\n").map((p) => p.replace(/^"/, "").split("/")[0]));
  const vazando = [...entradas].filter((e) => !/^[._]/.test(e) && !DO_SITE.has(e) && !fora.includes(e));
  assert.deepEqual(vazando, []);
  for (const e of fora) assert.ok(!DO_SITE.has(e), "arquivo do site no exclude: " + e);
});

test("sw: instala buscando do servidor, sem aceitar a cópia HTTP da versão anterior", () => {
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
  assert.match(sw, /new Request\(u, \{ cache: "reload" \}\)/);
});
