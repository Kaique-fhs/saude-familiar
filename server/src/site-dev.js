import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
const PROIBIDAS = new Set(['server', 'node_modules']);

// Manipulador http (node:http) que serve o site (raiz do repositório) no desenvolvimento.
// /config.js devolve o window.SF_CONFIG de dev; pastas do servidor e dotfiles dão 404.
export function criarManipuladorSite({ raiz, configDev }) {
  const base = resolve(raiz);
  const naoEncontrado = (res) => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('nao encontrado');
  };
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return naoEncontrado(res);
    let caminho;
    try {
      caminho = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    } catch {
      return naoEncontrado(res);
    }
    if (caminho.includes('\0')) return naoEncontrado(res);
    if (caminho === '/config.js') {
      res.writeHead(200, { 'content-type': TIPOS['.js'], 'cache-control': 'no-store' });
      return res.end(`window.SF_CONFIG = ${JSON.stringify(configDev)};\n`);
    }
    const partes = caminho.split(/[\/]+/).filter(Boolean);
    if (partes.some((p) => p === '..' || p.startsWith('.') || p.includes(':'))) return naoEncontrado(res);
    if (partes.length && PROIBIDAS.has(partes[0].toLowerCase())) return naoEncontrado(res);
    let alvo = resolve(base, ...partes);
    if (alvo !== base && !alvo.startsWith(base + sep)) return naoEncontrado(res);
    try {
      if ((await stat(alvo)).isDirectory()) alvo = resolve(alvo, 'index.html');
      const bytes = await readFile(alvo);
      res.writeHead(200, {
        'content-type': TIPOS[extname(alvo).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      naoEncontrado(res);
    }
  };
}
