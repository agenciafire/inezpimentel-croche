// netlify/functions/mailingboss-evento.js
//
// Recebe as inscrições da página "Muito Além do Crochê" (aula de 18/11/2026)
// e cadastra na lista do MailingBoss (Builderall) "Inez- Evento - Nov18".
// Usa a mesma chave já configurada no painel da Netlify para o site:
//   MAILINGBOSS_TOKEN = <chave de integração do MailingBoss>
//
// Referência: https://ajuda.builderall.com/books/integrações/page/mailingboss-50---integração-api

const LIST_UID = '6ada495a01817'; // Lista: Inez- Evento - Nov18
const MAILINGBOSS_BASE = 'https://member.mailingboss.com/integration/index.php';

const json = (statusCode, body) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
});

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido' });

    const token = process.env.MAILINGBOSS_TOKEN;
    if (!token) {
        console.error('MAILINGBOSS_TOKEN não configurado nas variáveis de ambiente da Netlify.');
        return json(500, { error: 'Configuração ausente no servidor' });
    }

    let data;
    try { data = JSON.parse(event.body || '{}'); }
    catch (e) { return json(400, { error: 'JSON inválido' }); }

    // Honeypot anti-spam: campo oculto preenchido = robô. Responde sucesso sem cadastrar.
    if (data.botField) return json(200, { status: 'success', bot: true });

    const nome = (data.nome || '').trim();
    const email = (data.email || '').trim().toLowerCase();
    const digits = (data.whatsapp || '').replace(/\D/g, '');

    const nomeOk = nome.split(/\s+/).filter(Boolean).length >= 2;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    const whatsOk = digits.length === 10 || digits.length === 11;
    if (!nomeOk || !emailOk || !whatsOk) return json(400, { error: 'Dados inválidos' });

    const payload = {
        list_uid: LIST_UID,
        name: nome,
        email: email,
        phone: digits,
        phoneprefix: '55BRAZIL'
    };

    try {
        const response = await fetch(`${MAILINGBOSS_BASE}/lists/subscribers/create/${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));

        if (result.status === 'success') return json(200, { status: 'success' });

        // Pessoa que se inscreve de novo com o mesmo e-mail: já está na lista, então conta como sucesso.
        const msg = JSON.stringify(result || {}).toLowerCase();
        if (/exist|already|cadastrad|duplic/.test(msg)) return json(200, { status: 'success', duplicate: true });

        console.error('MailingBoss retornou erro:', result);
        return json(502, { error: 'Falha ao cadastrar na lista' });
    } catch (err) {
        console.error('Erro ao chamar API do MailingBoss:', err);
        return json(502, { error: 'Erro de comunicação com o MailingBoss' });
    }
};
