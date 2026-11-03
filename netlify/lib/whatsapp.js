// netlify/lib/whatsapp.js
//
// Confirmação automática da inscrição no WhatsApp (API oficial da Meta).
// Usado pelas funções mailingboss-evento.js (Brasil) e mailingboss-evento-pt.js (Portugal).
//
// Tudo é configurado em Netlify > Configuração do projeto > Variáveis de ambiente:
//   WHATSAPP_ATIVO            "sim" liga o envio. Qualquer outro valor (ou vazio) desliga.
//   WHATSAPP_TOKEN            token permanente da Meta
//   WHATSAPP_PHONE_NUMBER_ID  ID do número (Phone Number ID)
//   WHATSAPP_TEMPLATE         nome do modelo do Brasil   (padrão: confirmacao_inscricao_aula)
//   WHATSAPP_TEMPLATE_PT      nome do modelo de Portugal (sem ele, Portugal NÃO recebe WhatsApp,
//                             porque o modelo do Brasil fala em 20h de Brasília)
//   WHATSAPP_IDIOMA           idioma do modelo do Brasil   (padrão: pt_BR)
//   WHATSAPP_IDIOMA_PT        idioma do modelo de Portugal (padrão: pt_PT)
//   WHATSAPP_PARAM_NOME       só se o modelo usar variável com nome (ex.: nome). Com {{1}}, deixe vazio.
//   WHATSAPP_API_VERSAO       padrão: v23.0
//
// Cada pessoa recebe a confirmação UMA vez por lista: quem já recebeu fica anotado
// no armazenamento da própria Netlify (Netlify Blobs), por e-mail e por telefone.
// Se o WhatsApp falhar, a inscrição continua valendo; a falha fica só no log.

const { getStore, connectLambda } = require('@netlify/blobs');

const TIMEOUT_MS = 4000;
const final4 = (tel) => '…' + String(tel).slice(-4);

function config(pais) {
    const e = process.env;
    const pt = pais === 'PT';
    return {
        ativo: (e.WHATSAPP_ATIVO || '').trim().toLowerCase() === 'sim',
        token: (e.WHATSAPP_TOKEN || '').trim(),
        phoneId: (e.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
        template: pt ? (e.WHATSAPP_TEMPLATE_PT || '').trim() : ((e.WHATSAPP_TEMPLATE || '').trim() || 'confirmacao_inscricao_aula'),
        idioma: pt ? ((e.WHATSAPP_IDIOMA_PT || '').trim() || 'pt_PT') : ((e.WHATSAPP_IDIOMA || '').trim() || 'pt_BR'),
        paramNome: (e.WHATSAPP_PARAM_NOME || '').trim().replace(/[{}]/g, ''),
        versao: (e.WHATSAPP_API_VERSAO || '').trim() || 'v23.0'
    };
}

function primeiroNome(nome) {
    const p = String(nome || '').trim().split(/\s+/)[0] || '';
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : 'tudo bem';
}

function abrirArmazenamento(event) {
    try {
        if (event && event.blobs) connectLambda(event);
        return getStore('whatsapp-confirmacoes');
    } catch (err) {
        console.warn('[WHATSAPP] Armazenamento indisponível (controle de repetição desligado):', err.message);
        return null;
    }
}

/**
 * Envia a confirmação, se estiver ligada e a pessoa ainda não tiver recebido.
 * Nunca lança erro: a inscrição não pode falhar por causa do WhatsApp.
 * @param {object} p  { event, pais: 'BR'|'PT', lista, nome, email, telefoneE164 (só dígitos, com código do país) }
 */
async function enviarConfirmacao({ event, pais, lista, nome, email, telefoneE164 }) {
    try {
        const c = config(pais);
        if (!c.ativo) return;
        if (!c.token || !c.phoneId) {
            console.warn('[WHATSAPP] Envio ligado, mas WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurado.');
            return;
        }
        if (!c.template) {
            console.warn(`[WHATSAPP] Sem modelo configurado para ${pais} (WHATSAPP_TEMPLATE_PT). Mensagem não enviada.`);
            return;
        }

        // Controle de repetição (por e-mail e por telefone, dentro da mesma lista)
        const store = abrirArmazenamento(event);
        const chaveEmail = `${lista}/email/${String(email).toLowerCase()}`;
        const chaveTel = `${lista}/tel/${telefoneE164}`;
        if (store) {
            try {
                const [a, b] = await Promise.all([store.get(chaveEmail), store.get(chaveTel)]);
                if (a || b) {
                    console.log(`[INFO] Inscrição repetida (${pais}, tel ${final4(telefoneE164)}): WhatsApp não reenviado.`);
                    return;
                }
            } catch (err) {
                console.warn('[WHATSAPP] Não consegui consultar o controle de repetição:', err.message);
            }
        }

        const param = { type: 'text', text: primeiroNome(nome) };
        if (c.paramNome) param.parameter_name = c.paramNome;

        const body = {
            messaging_product: 'whatsapp',
            to: telefoneE164,
            type: 'template',
            template: {
                name: c.template,
                language: { code: c.idioma },
                components: [{ type: 'body', parameters: [param] }]
            }
        };

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let res, json;
        try {
            res = await fetch(`https://graph.facebook.com/${c.versao}/${c.phoneId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}` },
                body: JSON.stringify(body),
                signal: ctrl.signal
            });
            json = await res.json().catch(() => ({}));
        } catch (err) {
            console.error(`[WHATSAPP] Erro de comunicação com a Meta (${pais}, tel ${final4(telefoneE164)}):`, err.name === 'AbortError' ? 'sem resposta em 4 segundos' : err.message);
            return;
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok || json.error) {
            const e = json.error || {};
            console.error(`[WHATSAPP] Meta recusou o envio (${pais}, tel ${final4(telefoneE164)}) código ${e.code || res.status}: ${e.message || ''} ${e.error_data && e.error_data.details ? '- ' + e.error_data.details : ''}`);
            return;
        }

        console.log(`[WHATSAPP] Aceito pela Meta (${pais}, tel ${final4(telefoneE164)}, modelo ${c.template}).`);
        if (store) {
            const marca = JSON.stringify({ em: new Date().toISOString() });
            await Promise.all([store.set(chaveEmail, marca), store.set(chaveTel, marca)]).catch((err) =>
                console.warn('[WHATSAPP] Enviado, mas não consegui anotar no controle de repetição:', err.message));
        }
    } catch (err) {
        console.error('[WHATSAPP] Erro inesperado:', err.message);
    }
}

module.exports = { enviarConfirmacao };
