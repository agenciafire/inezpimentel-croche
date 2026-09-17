exports.handler = async (event, context) => {
  // Aceita apenas chamadas via POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    // Opcional: defina META_TEST_EVENT_CODE no Netlify apenas enquanto estiver
    // testando no Gerenciador de Eventos > Testar Eventos. Remova em produção.
    const testEventCode = process.env.META_TEST_EVENT_CODE;

    // Garante que as variáveis foram carregadas
    if (!pixelId || !accessToken) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Variáveis de ambiente do Meta não foram configuradas no Netlify.' }),
      };
    }

    // Monta user_data apenas com os campos realmente enviados
    // (evita mandar chaves undefined, que a Graph API rejeita/ignora de forma inconsistente)
    const userData = {
      client_ip_address: event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'],
      client_user_agent: event.headers['user-agent'],
    };
    if (body.emailHash) userData.em = [body.emailHash];
    if (body.phoneHash) userData.ph = [body.phoneHash];
    if (body.fbp) userData.fbp = body.fbp;
    if (body.fbc) userData.fbc = body.fbc;
    if (body.externalId) userData.external_id = [body.externalId];

    // Estrutura do evento enviada para a Graph API do Facebook
    // Este projeto rastreia apenas o evento padrão PageView (sem eventos customizados).
    const eventPayload = {
      event_name: body.eventName || 'PageView',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: body.eventUrl || event.headers.referer || '',
      user_data: userData,
      // Parâmetro essencial para deduplicação com o Meta Pixel JS
      event_id: body.eventId,
    };

    const payload = { data: [eventPayload] };
    if (testEventCode) payload.test_event_code = testEventCode;

    // Envio para a API do Meta
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    // Propaga o erro real para os logs da function em caso de falha.
    return {
      statusCode: response.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
