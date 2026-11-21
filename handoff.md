# Handoff

## Decisões tomadas
- Servidor próprio na AWS, com app local primeiro: ADR-001. Login próprio: ADR-002. Região us-east-2: ADR-003. "Sair com pendências": opção A do Kaique, ADR-004 em gravação (em `docs/ams/adr/`).
- Máquina mantida ligada (~US$ 11,50/mês nos créditos), decisão do Kaique.
- Rulings e pendências dos planos 1, 2 e 5 estão em `docs/superpowers/plans/2026-11-21-contas-roteiro.md` ("Rulings do plano 5", "Pendências menores do plano 5", "Para o plano 3").

## Estado atual
- Planos 1, 2 e 5 concluídos e juntados em `feat/contas-ec2` (a642551, com push): servidor 112 ok / 6 skip, site 100 ok, `validar.sh` ok, `testar_maquina.sh` 194/194. Sem PR.
- AWS no ar (stack `saude-familiar`, us-east-2), fumaça de ponta a ponta OK. URLs e saídas em `server/infra/README.md`.
- O site no ar continua sendo o `main` (sem login).
- E-mail do app: saudefamiliarr@gmail.com (verificação em 2 etapas ligada, senha de app no SSM). Segredos só no SSM `/saude-familiar/{teste,producao}/*`.
- Turnstile site key (pública): `0x4AAAAAAGMIsSAsmJojK__Y`; vai no `config.js` do site no lançamento.
- Falta aplicar na AWS o update da stack (lifecycle e versionamento do BucketBackups, `AlarmeTravada`) e reprovisionar a máquina: espera OK do Kaique.

## Próximos passos
- Plano 3 (plano e metas por pessoa): escrever o plano a partir da spec; começa pelo parked `naoGravado` e pelo cursor do `/sync`.
- Plano 4 (migração do app antigo).
- Plano 6 (lançamento 2): checklist da Rejane, tirar `PLANO` do `data.js`, remover modo antigo.

## Dúvidas em aberto
- OK do Kaique para o update da stack e o reprovisionamento (acima).
- Alinhar a spec §8.1 ao ADR-004 depois que ele for gravado.
- Kaique limpar os dados `mp-*` de teste no Chrome (`localhost:5500`).
