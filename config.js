// Configuração do site: API de produção e chave pública do Turnstile (nada aqui é segredo).
// Com apiUrl vazio o app funciona só no aparelho, sem conta nem sincronização.
// O servidor de desenvolvimento (server, npm run dev) serve outros valores neste endereço.
window.SF_CONFIG = {
  apiUrl: "https://d24j5hln30wud.cloudfront.net",
  turnstileChave: "0x4AAAAAAGMIsSAsmJojK__Y",
  cabecalhoOrigemDev: ""
};
