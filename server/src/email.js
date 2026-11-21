import nodemailer from 'nodemailer';

// Interface Email: enviar({ para, assunto, texto }) -> Promise<void>
export function criarEmailSmtp(smtp) {
  const transporte = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.porta,
    secure: smtp.porta === 465,
    auth: { user: smtp.usuario, pass: smtp.senha },
  });
  return {
    async enviar({ para, assunto, texto }) {
      await transporte.sendMail({ from: smtp.remetente, to: para, subject: assunto, text: texto });
    },
  };
}
