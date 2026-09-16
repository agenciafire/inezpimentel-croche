// netlify/functions/mailingboss-lead.js
//
// Recebe o lead do formulário de interesse (Fios que Curam / Inêz Pimentel)
// e cadastra na lista do MailingBoss (Builderall) via API server-side,
// mantendo o TOKEN oculto.
//
// Requer variável de ambiente configurada no painel da Netlify:
//   MAILINGBOSS_TOKEN = <chave de integração do MailingBoss>
//
// Documentação oficial usada como referência:
// https://ajuda.builderall.com/books/integrações/page/mailingboss-50---integração-api

const LIST_UID = '6aaadd902673b'; // Lista: Fios que Curam
const MAILINGBOSS_BASE = 'https://member.mailingboss.com/integration/index.php';

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Método não permitido' }) };
    }

    const token = process.env.MAILINGBOSS_TOKEN;
    if (!token) {
        console.error('MAILINGBOSS_TOKEN não configurado nas variáveis de ambiente da Netlify.');
        return { statusCode: 500, body: JSON.stringify({ error: 'Configuração ausente no servidor' }) };
    }

    let data;
    try {
        data = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    // Honeypot anti-spam: se algum campo oculto vier preenchido no futuro,
    // é bot. Responde "sucesso" pro bot sem realmente enviar ao MailingBoss.
    if (data.botField) {
        return { statusCode: 200, body: JSON.stringify({ status: 'success', bot: true }) };
    }

    const nome = (data.nome || '').trim();
    const email = (data.email || '').trim();
    const whatsappRaw = (data.whatsapp || '').trim();
    const cidade = (data.cidade || '').trim();
    const perfil = (data.perfil || '').trim();
    const conteMais = (data.conteMais || '').trim();

    // Validação server-side básica (espelha a validação client-side)
    const nameOk = nome.length >= 2;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const digits = whatsappRaw.replace(/\D/g, '');
    const whatsappOk = digits.length === 10 || digits.length === 11;
    const perfilOk = perfil.length > 0;

    if (!nameOk || !emailOk || !whatsappOk || !perfilOk) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Dados inválidos' }) };
    }

    // Tags dos campos confirmadas na lista "Fios que Curam" (list_uid acima):
    // NAME, EMAIL, PHONE, PHONEPREFIX, CIDADE, OPCAOSITUACAO, TEXTO
    const phone = digits;
    const phonePrefix = '55BRAZIL';

    const payload = {
        list_uid: LIST_UID,
        name: nome,
        email: email,
        phone: phone,
        phoneprefix: phonePrefix,
        cidade: cidade,
        opcaosituacao: perfil,
        texto: conteMais
    };

    try {
        const response = await fetch(
            `${MAILINGBOSS_BASE}/lists/subscribers/create/${token}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        const result = await response.json();

        if (result.status !== 'success') {
            console.error('MailingBoss retornou erro:', result);
            return { statusCode: 502, body: JSON.stringify({ error: 'Falha ao cadastrar na lista', details: result }) };
        }

        return { statusCode: 200, body: JSON.stringify({ status: 'success', data: result.data }) };
    } catch (err) {
        console.error('Erro ao chamar API do MailingBoss:', err);
        return { statusCode: 502, body: JSON.stringify({ error: 'Erro de comunicação com o MailingBoss' }) };
    }
};
