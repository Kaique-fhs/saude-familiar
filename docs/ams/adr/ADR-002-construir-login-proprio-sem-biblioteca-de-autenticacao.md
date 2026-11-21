# ADR-002 - Construir login proprio sem biblioteca de autenticacao

**Status:** Aceito
**Data:** 21/11/2026

## Contexto
O ADR-001 previa a biblioteca Better Auth para cadastro, sessão e troca de senha. O Kaique decidiu ter uma estrutura própria de login.

- login guarda senhas e dá acesso a dados de saúde
- sem biblioteca, os erros clássicos de segurança passam a ser responsabilidade nossa

---

## Decisao
O login é código próprio da API, usando só a criptografia do Node (`node:crypto`).

- senha guardada com `scrypt` e sal aleatório por usuário, nunca em texto
- sessão por token aleatório de 32 bytes no cabeçalho `Authorization`; o banco guarda só o hash SHA-256 do token
- sessão expira após 60 dias sem uso; sair apaga a sessão no servidor
- tokens de confirmação de e-mail (24 h) e de troca de senha (1 h) aleatórios, de uso único e guardados como hash
- comparações em tempo constante (`timingSafeEqual`); cadastro e "esqueci minha senha" respondem igual se o e-mail existe ou não
- trocar a senha encerra todas as sessões da conta
- cada regra acima tem teste automatizado

---

## Consequencias
- sem dependência de biblioteca de login; controle total do fluxo
- mais código para escrever e manter
- a segurança do login fica por nossa conta, sem as proteções que a biblioteca já trazia

---

## Alternativas consideradas
- Better Auth - substituída por decisão do Kaique de ter estrutura própria de login

---

## Referencias
- ADR-001-usar-servidor-proprio-na-aws-para-contas-com-app-local-primeiro.md
- docs/superpowers/specs/2026-11-21-contas-ec2-design.md
- Convencao de nome: `ADR-NNN` — tres digitos, minusculas e tracos, sem prefixo; a serie `ADR-LOCAL-*` foi aposentada (ADR-009). Ver `docs/ams/adr/README_ADR.md`.
