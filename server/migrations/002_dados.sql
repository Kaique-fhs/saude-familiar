create sequence itens_seq;

create table itens (
  user_id uuid not null references usuarios(id) on delete cascade,
  tipo text not null check (tipo in ('fav','sel','check','checkplano','quero','feito','treino','registro','plano','meta')),
  chave text not null check (length(chave) between 1 and 200),
  valor jsonb,
  ativo boolean not null default true,
  em timestamptz not null,
  seq bigint not null default nextval('itens_seq'),
  primary key (user_id, tipo, chave)
);

create index itens_user_seq on itens (user_id, seq);

create table contas_apagadas (
  user_id uuid primary key,
  apagada_em timestamptz not null,
  fotos_apagadas_em timestamptz
);

create table envios_email (
  dia date primary key,
  total int not null
);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'saude_app') then
    create role saude_app nologin;
  end if;
  if not pg_has_role(current_user, 'saude_app', 'MEMBER') then
    grant saude_app to current_user;
  end if;
end
$$;

grant select, insert, update, delete on itens to saude_app;
grant usage, select on sequence itens_seq to saude_app;

alter table itens enable row level security;
alter table itens force row level security;

create policy itens_dono on itens to saude_app
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);
