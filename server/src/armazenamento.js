import {
  S3Client,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const VALIDADE_SEG = 300;
const MAX_BYTES = 5 * 1024 * 1024;
const LOTE = 1000;

// Credenciais pela cadeia padrão do SDK (papel da EC2 em produção).
// `cliente` é opcional: os testes injetam um S3Client (ou falso).
export function criarArmazenamentoS3({ regiao, bucket, cliente = new S3Client({ region: regiao }) }) {
  async function apagarLote(objetos) {
    const r = await cliente.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objetos, Quiet: true } }),
    );
    if (r?.Errors?.length) throw new Error(`s3: falha ao apagar ${r.Errors.length} objeto(s)`);
  }

  return {
    async urlEnvio(chave) {
      const { url, fields } = await createPresignedPost(cliente, {
        Bucket: bucket,
        Key: chave,
        Conditions: [
          ['content-length-range', 1, MAX_BYTES],
          ['eq', '$Content-Type', 'image/jpeg'],
        ],
        Fields: { 'Content-Type': 'image/jpeg' },
        Expires: VALIDADE_SEG,
      });
      return { url, campos: fields };
    },

    urlLeitura(chave) {
      return getSignedUrl(cliente, new GetObjectCommand({ Bucket: bucket, Key: chave }), {
        expiresIn: VALIDADE_SEG,
      });
    },

    async apagarPrefixo(prefixo) {
      if (typeof prefixo !== 'string' || !prefixo.endsWith('/')) throw new Error('prefixo');
      let pendentes = [];
      let keyMarker;
      let versionIdMarker;
      do {
        const pagina = await cliente.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: prefixo,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          }),
        );
        for (const v of [...(pagina.Versions ?? []), ...(pagina.DeleteMarkers ?? [])]) {
          pendentes.push({ Key: v.Key, VersionId: v.VersionId });
        }
        while (pendentes.length >= LOTE) {
          await apagarLote(pendentes.slice(0, LOTE));
          pendentes = pendentes.slice(LOTE);
        }
        keyMarker = pagina.IsTruncated ? pagina.NextKeyMarker : undefined;
        versionIdMarker = pagina.IsTruncated ? pagina.NextVersionIdMarker : undefined;
      } while (keyMarker !== undefined || versionIdMarker !== undefined);
      if (pendentes.length) await apagarLote(pendentes);
    },
  };
}
