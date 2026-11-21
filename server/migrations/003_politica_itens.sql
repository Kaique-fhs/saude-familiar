-- app.user_id vazio ('' numa conexão reaproveitada do pool, depois de set_config local)
-- não pode virar erro de cast para uuid: nullif devolve null e a política não casa com nenhuma linha.
drop policy if exists itens_dono on itens;

create policy itens_dono on itens to saude_app
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
