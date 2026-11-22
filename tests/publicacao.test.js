const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const raiz = path.join(__dirname, "..");
const DO_SITE = new Set([
  "index.html", "privacidade.html", "app.js", "config.js", "data.js", "styles.css", "sw.js", "js", "manifest.webmanifest",
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

test("scripts do site no index e no cache, na mesma versão", () => {
  const index = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
  const scripts = [...index.matchAll(/<script src="([^"?]+)\?v=(\d+)"/g)].map((m) => ({ src: m[1], v: m[2] }));
  const versao = (sw.match(/VERSAO = "meu-prato-v(\d+)"/) || [])[1];
  assert.ok(versao, "VERSAO no sw.js");
  for (const s of scripts.filter((x) => x.src.startsWith("js/"))) {
    assert.ok(sw.includes('"./' + s.src + "?v=" + versao + '"'), "fora do cache: " + s.src);
  }
  for (const s of scripts) assert.equal(s.v, versao, "versão de " + s.src);
  const ordem = scripts.map((s) => s.src);
  assert.ok(ordem.includes("js/sf-plano.js"), "sf-plano.js no index");
  assert.ok(ordem.indexOf("js/sf-plano.js") < ordem.indexOf("app.js"), "sf-plano antes de app.js");
  assert.ok(ordem.includes("js/sf-editor.js"), "sf-editor.js no index");
  assert.ok(ordem.indexOf("js/sf-editor.js") < ordem.indexOf("app.js"), "sf-editor antes de app.js");
});

test("versão de cache 37", () => {
  const index = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
  assert.match(sw, /VERSAO = "meu-prato-v37"/);
  assert.ok(index.includes("app.js?v=37"));
  assert.ok(!/\?v=(?!37)\d+/.test(index), "todo ?v= do index vale 37");
});
