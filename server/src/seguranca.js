import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const N = 32768;
const R = 8;
const P = 1;
const TAMANHO_CHAVE = 64;
const MAXMEM = 64 * 1024 * 1024;

function derivar(senha, sal, n, r, p) {
  return scryptAsync(senha, sal, TAMANHO_CHAVE, { N: n, r, p, maxmem: MAXMEM });
}

export async function hashSenha(senha) {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${chave.toString('base64')}`;
}

export async function conferirSenha(senha, guardado) {
  try {
    if (typeof senha !== 'string' || typeof guardado !== 'string') return false;
    const partes = guardado.split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
    const [n, r, p] = partes.slice(1, 4).map(Number);
    if (![n, r, p].every(Number.isInteger) || n < 2 || r < 1 || p < 1) return false;
    const sal = Buffer.from(partes[4], 'base64');
    const esperado = Buffer.from(partes[5], 'base64');
    if (sal.length === 0 || esperado.length !== TAMANHO_CHAVE) return false;
    const chave = await derivar(senha, sal, n, r, p);
    return timingSafeEqual(chave, esperado);
  } catch {
    return false;
  }
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function novoToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

// Gasta o mesmo tempo de uma conferência real quando o e-mail não existe.
export const HASH_FALSO = await hashSenha(randomBytes(16).toString('hex'));
