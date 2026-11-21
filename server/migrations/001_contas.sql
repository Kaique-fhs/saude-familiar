create table usuarios (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  senha_hash text not null,
  confirmado_em timestamptz,
  criado_em timestamptz not null default now()
);

create table sessoes (
  hash text primary key,
  user_id uuid not null references usuarios(id) on delete cascade,
  criada_em timestamptz not null default now(),
  ultimo_uso timestamptz not null default now()
);

create table tokens (
  hash text primary key,
  user_id uuid not null references usuarios(id) on delete cascade,
  tipo text not null check (tipo in ('confirmar','senha')),
  expira_em timestamptz not null,
  usado_em timestamptz
);
