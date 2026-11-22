-- Prova do consentimento (LGPD art. 8º §2º): uma linha por finalidade e versão do aviso.
-- 'saude': art. 11, I (com a declaração de 18 anos). 'transferencia': art. 33, VIII.
-- Sem grant para saude_app: só as rotas de conta, como dono, leem e gravam.
create table aceites (
  user_id uuid not null references usuarios(id) on delete cascade,
  tipo text not null check (tipo in ('saude','transferencia')),
  versao text not null,
  em timestamptz not null,
  primary key (user_id, tipo, versao)
);
