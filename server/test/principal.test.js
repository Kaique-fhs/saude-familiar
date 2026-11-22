import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// principal.js de verdade, num processo à parte, só trocando o Postgres pelo PGlite.
test('a API de produção escuta só em 127.0.0.1', { timeout: 60_000 }, async () => {
  const banco = new URL('../src/banco.js', import.meta.url).href;
  const troca = `import { criarBancoPglite } from '${banco}'; const b = await criarBancoPglite(); export const criarBancoPg = () => b;`;
  const preparo = `
    import { registerHooks } from 'node:module';
    import net from 'node:net';
    registerHooks({ resolve(alvo, contexto, seguinte) {
      if (alvo === './banco.js' && contexto.parentURL?.endsWith('/src/principal.js'))
        return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(troca)}`)}, shortCircuit: true };
      return seguinte(alvo, contexto);
    } });
    net.Server.prototype.listen = function (opcoes) {
      console.log('ESCUTA=' + opcoes.host);
      process.exit(0);
    };`;
  const filho = spawn(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(preparo)}`, fileURLToPath(new URL('../src/principal.js', import.meta.url))],
    { env: { ...process.env, SEGREDO_ORIGEM: 'segredo', ORIGEM_SITE: 'https://site.invalid', PORT: '39123' } },
  );
  let saida = '';
  filho.stdout.on('data', (d) => (saida += d));
  filho.stderr.on('data', (d) => (saida += d));
  const codigo = await new Promise((ok) => filho.on('close', ok));
  assert.equal(codigo, 0, saida);
  assert.equal(saida.match(/ESCUTA=(\S+)/)?.[1], '127.0.0.1');
});
