# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003 (em `docs/ams/adr/`).
- Rulings e triagens dos planos 1 e 2 estão no roteiro `docs/superpowers/plans/2026-11-21-contas-roteiro.md` ("Pendências", "Para o plano 3", conflitos de merge).
- Plano 2: sair com pendências mantém dados, fila e fotos (diverge da spec §8.1; alinhar spec ou ADR, ver "Para o plano 3").

## Estado atual
- Plano 1 pronto (`feat/contas-ec2`). Plano 2 pronto (`feat/app-conta-sync`, e285582..a93c407, 100 testes do site, 103 do servidor, navegador headless 47/47). Plano 5 tasks 1-5 prontas (`feat/aws-infra`).
- Plano 5 PARADO na Task 6, esperando o OK do Kaique sobre: a lista de 15 recursos (~US$ 11,50/mês, t4g.micro); a conta Gmail do app com senha de app; a conta Cloudflare com o widget Turnstile.
- Nada criado na AWS ainda. Nada com push nem PR.
- Três worktrees: `../saude-familiar`, `../saude-familiar-app`, `../saude-familiar-aws`.
- Site em produção (`main`) intocado e funcionando como antes.

## Próximos passos
- Tasks 6-8 do plano 5 (criam recursos pagos; só após o OK acima).
- Juntar os branches (conflitos triviais previstos em `server/package.json`, `server/test/app.test.js`, `server/test/banco.test.js`); rodar `npm test` em `server/` depois.
- Planos 3 e 4. Plano 3 começa pelo parked `naoGravado` e pelo cursor do `/sync`.

## Dúvidas em aberto
- OK do Kaique para a Task 6 (lista de recursos, Gmail, Cloudflare/Turnstile).
- Spec §8.1 x "sair com pendências mantém dados": alinhar spec ou ADR.
- Kaique limpar os dados `mp-*` de teste no Chrome (`localhost:5500`).
