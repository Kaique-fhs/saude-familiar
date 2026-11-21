import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cabecalhos, contaLogada, criarAppTeste, armazenamentoFalso } from './ajuda.js';
import { chaveFoto } from '../src/fotos.js';
import { criarArmazenamentoS3 } from '../src/armazenamento.js';

const FOTO = 'f-2026-11-21-almoco-1763726400000';

function clienteFalso({ paginas, erros } = {}) {
  const comandos = [];
  let n = 0;
  return {
    comandos,
    async send(comando) {
      const tipo = comando.constructor.name;
      comandos.push({ tipo, entrada: comando.input });
      if (tipo === 'ListObjectVersionsCommand') return paginas[n++];
      if (tipo === 'DeleteObjectsCommand') return erros ? { Errors: erros } : { Deleted: [] };
      throw new Error(`comando inesperado ${tipo}`);
    },
  };
}

test('apagarPrefixo com cliente falso: duas páginas, versões e delete markers → tudo enviado para DeleteObjects', async () => {
  const cliente = clienteFalso({
    paginas: [
      {
        IsTruncated: true,
        NextKeyMarker: 'k2',
        NextVersionIdMarker: 'v2',
        Versions: [{ Key: 'teste/u1/a.jpg', VersionId: 'v1' }],
        DeleteMarkers: [{ Key: 'teste/u1/a.jpg', VersionId: 'dm1' }],
      },
      { IsTruncated: false, Versions: [{ Key: 'teste/u1/b.jpg', VersionId: 'v3' }] },
    ],
  });
  const arm = criarArmazenamentoS3({ regiao: 'us-east-2', bucket: 'b', cliente });
  await arm.apagarPrefixo('teste/u1/');
  const listas = cliente.comandos.filter((c) => c.tipo === 'ListObjectVersionsCommand');
  assert.equal(listas.length, 2);
  assert.equal(listas[0].entrada.Prefix, 'teste/u1/');
  assert.equal(listas[1].entrada.KeyMarker, 'k2');
  assert.equal(listas[1].entrada.VersionIdMarker, 'v2');
  const apagados = cliente.comandos
    .filter((c) => c.tipo === 'DeleteObjectsCommand')
    .flatMap((c) => c.entrada.Delete.Objects);
  assert.deepEqual(apagados, [
    { Key: 'teste/u1/a.jpg', VersionId: 'v1' },
    { Key: 'teste/u1/a.jpg', VersionId: 'dm1' },
    { Key: 'teste/u1/b.jpg', VersionId: 'v3' },
  ]);
});

test('apagarPrefixo: mais de 1000 itens são apagados em lotes de até 1000', async () => {
  const versoes = Array.from({ length: 1500 }, (_, i) => ({ Key: `teste/u1/${i}.jpg`, VersionId: `v${i}` }));
  const cliente = clienteFalso({ paginas: [{ IsTruncated: false, Versions: versoes }] });
  await criarArmazenamentoS3({ regiao: 'us-east-2', bucket: 'b', cliente }).apagarPrefixo('teste/u1/');
  const lotes = cliente.comandos.filter((c) => c.tipo === 'DeleteObjectsCommand');
  assert.deepEqual(lotes.map((l) => l.entrada.Delete.Objects.length), [1000, 500]);
});

test('apagarPrefixo: resposta com Errors → lança', async () => {
  const cliente = clienteFalso({
    paginas: [{ IsTruncated: false, Versions: [{ Key: 'teste/u1/a.jpg', VersionId: 'v1' }] }],
    erros: [{ Key: 'teste/u1/a.jpg', Code: 'AccessDenied' }],
  });
  await assert.rejects(
    criarArmazenamentoS3({ regiao: 'us-east-2', bucket: 'b', cliente }).apagarPrefixo('teste/u1/'),
  );
});

test('urlLeitura e urlEnvio assinam offline, 5 min, 5 MB e image/jpeg', async () => {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const cliente = new S3Client({
    region: 'us-east-2',
    credentials: { accessKeyId: 'AKIAFALSO', secretAccessKey: 'segredo-falso' },
  });
  const arm = criarArmazenamentoS3({ regiao: 'us-east-2', bucket: 'bucket-teste', cliente });
  const leitura = new URL(await arm.urlLeitura('teste/u1/x.jpg'));
  assert.match(leitura.hostname, /bucket-teste/);
  assert.equal(leitura.searchParams.get('X-Amz-Expires'), '300');
  const envio = await arm.urlEnvio('teste/u1/x.jpg');
  assert.match(envio.url, /bucket-teste/);
  assert.equal(envio.campos.key, 'teste/u1/x.jpg');
  assert.equal(envio.campos['Content-Type'], 'image/jpeg');
  const politica = JSON.parse(Buffer.from(envio.campos.Policy, 'base64').toString());
  assert.ok(politica.conditions.some((c) => c[0] === 'content-length-range' && c[1] === 1 && c[2] === 5 * 1024 * 1024));
});

test('chaveFoto monta <ambiente>/<userId>/<fotoId>.jpg e valida o id', () => {
  assert.equal(chaveFoto('teste', 'u1', FOTO), `teste/u1/${FOTO}.jpg`);
  assert.throws(() => chaveFoto('teste', 'u1', '../x'), { message: 'foto-id' });
});

test('envio gera chave teste/<meuId>/<fotoId>.jpg', async () => {
  const armazenamento = armazenamentoFalso();
  const { app } = await criarAppTeste({ deps: { armazenamento } });
  const eu = await contaLogada(app, 'a@exemplo.com');
  const r = await app.inject({
    method: 'POST',
    url: `/fotos/${FOTO}/envio`,
    headers: cabecalhos({ authorization: `Bearer ${eu.token}` }),
  });
  assert.equal(r.statusCode, 200);
  const chave = `teste/${eu.id}/${FOTO}.jpg`;
  assert.deepEqual(armazenamento.chamadas, [{ tipo: 'envio', chave }]);
  assert.equal(r.json().url, `https://falso/${chave}`);
  assert.deepEqual(r.json().campos, { key: chave });
});

test('fotoId com ../ → 400 foto-id', async () => {
  const { app } = await criarAppTeste();
  const eu = await contaLogada(app, 'a@exemplo.com');
  const h = cabecalhos({ authorization: `Bearer ${eu.token}` });
  const r = await app.inject({ method: 'GET', url: '/fotos/..%2Fx', headers: h });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.json(), { erro: 'foto-id' });
});

test('fotoId fora do formato → 400', async () => {
  const { app } = await criarAppTeste();
  const eu = await contaLogada(app, 'a@exemplo.com');
  const h = cabecalhos({ authorization: `Bearer ${eu.token}` });
  for (const id of ['abc', 'f-2026-11-21-x-123', 'F-2026-11-21-x-1763726400000']) {
    const r = await app.inject({ method: 'POST', url: `/fotos/${id}/envio`, headers: h });
    assert.equal(r.statusCode, 400, id);
    assert.deepEqual(r.json(), { erro: 'foto-id' });
  }
});

test('leitura usa o id da sessão: A pedindo a foto de B gera chave com o id de A', async () => {
  const armazenamento = armazenamentoFalso();
  const { app } = await criarAppTeste({ deps: { armazenamento } });
  const a = await contaLogada(app, 'a@exemplo.com');
  const b = await contaLogada(app, 'b@exemplo.com');
  const r = await app.inject({
    method: 'GET',
    url: `/fotos/${FOTO}?userId=${b.id}`,
    headers: cabecalhos({ authorization: `Bearer ${a.token}` }),
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(armazenamento.chamadas, [{ tipo: 'leitura', chave: `teste/${a.id}/${FOTO}.jpg` }]);
  assert.ok(!armazenamento.chamadas[0].chave.includes(b.id));
  assert.deepEqual(r.json(), { url: `https://falso/teste/${a.id}/${FOTO}.jpg` });
});

test('sem sessão → 401', async () => {
  const { app } = await criarAppTeste();
  const e = await app.inject({ method: 'POST', url: `/fotos/${FOTO}/envio`, headers: cabecalhos() });
  const l = await app.inject({ method: 'GET', url: `/fotos/${FOTO}`, headers: cabecalhos() });
  assert.equal(e.statusCode, 401);
  assert.equal(l.statusCode, 401);
});
