// netlify/functions/mailingboss-evento-pt.js
//
// Recebe as inscrições da página de PORTUGAL "Muito Além do Crochê"
// (/muito-alem-do-croche-pt/) e cadastra na lista do MailingBoss (Builderall)
// "Inez- Evento - Nov18 - Portugal".
// Usa a mesma chave já configurada no painel da Netlify:
//   MAILINGBOSS_TOKEN = <chave de integração do MailingBoss>

const LIST_UID = '6ae54fc413736';      // Lista: Inez- Evento - Nov18 - Portugal
const PHONE_PREFIX = '351PORTUGAL';    // Indicativo de Portugal (+351) no formato do MailingBoss
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
    // Telemóvel português: 9 dígitos começando por 9. Aceita vir com 351 / 00351 na frente.
    const digits = (data.whatsapp || '').replace(/\D/g, '').replace(/^(00351|351)(?=9\d{8}$)/, '');

    const nomeOk = nome.split(/\s+/).filter(Boolean).length >= 2;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    const whatsOk = /^9\d{8}$/.test(digits);
    if (!nomeOk || !emailOk || !whatsOk) return json(400, { error: 'Dados inválidos' });

    const payload = {
        list_uid: LIST_UID,
        name: nome,
        email: email,
        phone: digits,
        phoneprefix: PHONE_PREFIX
    };

    try {
        const response = await fetch(`${MAILINGBOSS_BASE}/lists/subscribers/create/${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));

        if (result.status === 'success') return json(200, { status: 'success' });

        const msg = JSON.stringify(result || {}).toLowerCase();
        if (/exist|already|cadastrad|duplic/.test(msg)) return json(200, { status: 'success', duplicate: true });

        console.error('MailingBoss retornou erro:', result);
        return json(502, { error: 'Falha ao cadastrar na lista', details: result });
    } catch (err) {
        console.error('Erro ao chamar API do MailingBoss:', err);
        return json(502, { error: 'Erro de comunicação com o MailingBoss' });
    }
};
