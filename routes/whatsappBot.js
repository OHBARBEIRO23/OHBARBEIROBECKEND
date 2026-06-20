/**
 * routes/whatsappBot.js — Bot de agendamento via WhatsApp (Z-API)
 * Oh Barbeiro
 *
 * Etapa 1: webhook + menu principal + pausar/retomar
 * (As etapas de marcar horário, ver agendamentos e cancelar
 *  são adicionadas nos próximos passos, reaproveitando esta base.)
 */

const { dbGet, dbSet } = require('../firebase');

// ─── CONFIG Z-API (mesmas variáveis usadas em cobranca.js) ─────────────────────
const ZAPI_BASE = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;
const ZAPI_HEADERS = {
  'Content-Type': 'application/json',
  'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
};

async function enviarTexto(telefone, mensagem) {
  const numero = telefone.replace(/\D/g, '');
  const resp = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: ZAPI_HEADERS,
    body: JSON.stringify({ phone: numero, message: mensagem }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`Z-API erro: ${JSON.stringify(json)}`);
  return json;
}

// ─── NORMALIZAÇÃO DE TELEFONE ───────────────────────────────────────────────────
// Compara só os últimos 8-9 dígitos, pra não depender de formatação (com/sem DDI, parênteses etc).
function ultimosDigitos(telefone, n = 9) {
  const digitos = (telefone || '').replace(/\D/g, '');
  return digitos.slice(-n);
}

function telefonesIguais(a, b) {
  if (!a || !b) return false;
  return ultimosDigitos(a) === ultimosDigitos(b);
}

// ─── SESSÕES DE CONVERSA (estado por telefone) ──────────────────────────────────
async function getSessao(telefone) {
  const sessoes = await dbGet('whatsapp_sessoes') || {};
  const chave = ultimosDigitos(telefone);
  return sessoes[chave] || { step: 'menu' };
}

async function setSessao(telefone, sessao) {
  const sessoes = await dbGet('whatsapp_sessoes') || {};
  const chave = ultimosDigitos(telefone);
  sessoes[chave] = { ...sessao, atualizado: new Date().toISOString() };
  await dbSet('whatsapp_sessoes', sessoes);
}

async function limparSessao(telefone) {
  const sessoes = await dbGet('whatsapp_sessoes') || {};
  const chave = ultimosDigitos(telefone);
  delete sessoes[chave];
  await dbSet('whatsapp_sessoes', sessoes);
}

// ─── PAUSAS (bot desligado para um número específico) ───────────────────────────
async function isPausado(telefone) {
  const pausas = await dbGet('bot_pausas') || {};
  const chave = ultimosDigitos(telefone);
  return !!pausas[chave];
}

async function pausarBot(telefone, motivo = 'manual') {
  const pausas = await dbGet('bot_pausas') || {};
  const chave = ultimosDigitos(telefone);
  pausas[chave] = { desde: new Date().toISOString(), motivo, telefone };
  await dbSet('bot_pausas', pausas);
}

async function retomarBot(telefone) {
  const pausas = await dbGet('bot_pausas') || {};
  const chave = ultimosDigitos(telefone);
  delete pausas[chave];
  await dbSet('bot_pausas', pausas);
}

// ─── MENU PRINCIPAL ──────────────────────────────────────────────────────────────
const MENU_PRINCIPAL =
  `Olá! 👋 Bem-vindo à *Oh Barbeiro*.\n\n` +
  `Como posso te ajudar?\n\n` +
  `*1* - Marcar horário\n` +
  `*2* - Ver meus agendamentos\n` +
  `*3* - Cancelar agendamento\n` +
  `*4* - Falar com atendente\n\n` +
  `Digite o número da opção.`;

const MENU_INVALIDO =
  `Não entendi 🤔\n\n` + MENU_PRINCIPAL;

// ─── PROCESSAMENTO DA MENSAGEM RECEBIDA ─────────────────────────────────────────
async function processarMensagem(telefone, textoRecebido) {
  const texto = (textoRecebido || '').trim();
  const textoLower = texto.toLowerCase();

  // Comandos de pausa funcionam sempre, independente do estado da conversa
  if (textoLower === '/pausar') {
    await pausarBot(telefone, 'comando');
    await enviarTexto(telefone, '🔇 Bot pausado para esta conversa. Vou parar de responder automaticamente. Mande */retomar* quando quiser que eu volte.');
    return;
  }
  if (textoLower === '/retomar') {
    await retomarBot(telefone);
    await limparSessao(telefone);
    await enviarTexto(telefone, '🔊 Bot reativado!');
    await enviarTexto(telefone, MENU_PRINCIPAL);
    return;
  }

  // Se está pausado, não responde mais nada (até /retomar ou o admin reativar pelo painel)
  if (await isPausado(telefone)) return;

  const sessao = await getSessao(telefone);

  switch (sessao.step) {
    case 'menu':
    default:
      await tratarMenuPrincipal(telefone, texto);
      break;

    // Os próximos steps (marcar_servico, marcar_barbeiro, marcar_data, marcar_hora,
    // marcar_confirmar, ver_agendamentos, cancelar_escolher, cancelar_confirmar)
    // são implementados nas próximas etapas do projeto.
  }
}

async function tratarMenuPrincipal(telefone, texto) {
  switch (texto) {
    case '1':
      // Próxima etapa: inicia fluxo de marcação (lista de serviços)
      await enviarTexto(telefone, '🗓️ Marcar horário — em breve! Essa parte ainda está sendo construída.');
      break;
    case '2':
      // Próxima etapa: lista agendamentos futuros do cliente
      await enviarTexto(telefone, '📋 Ver agendamentos — em breve! Essa parte ainda está sendo construída.');
      break;
    case '3':
      // Próxima etapa: lista agendamentos para cancelar
      await enviarTexto(telefone, '❌ Cancelar agendamento — em breve! Essa parte ainda está sendo construída.');
      break;
    case '4':
      await pausarBot(telefone, 'cliente_pediu_atendente');
      await enviarTexto(telefone, '👤 Combinado! Um atendente vai te responder por aqui em breve. Se quiser voltar a falar com o bot, é só mandar */retomar*.');
      break;
    default:
      await enviarTexto(telefone, MENU_INVALIDO);
      break;
  }
}

// ─── WEBHOOK (chamado pela Z-API a cada mensagem recebida) ──────────────────────
async function handleWebhook(req, res) {
  try {
    const body = req.body || {};

    // Ignora eventos que não são mensagem de texto recebida de um contato real
    if (body.fromMe) return res.json({ ok: true, ignorado: 'mensagem própria' });
    if (body.isGroup) return res.json({ ok: true, ignorado: 'mensagem de grupo' });
    if (!body.phone || !body.text || !body.text.message) {
      return res.json({ ok: true, ignorado: 'evento sem texto' });
    }

    await processarMensagem(body.phone, body.text.message);
    res.json({ ok: true });
  } catch (err) {
    console.error('[whatsappBot] Erro no webhook:', err.message);
    // Sempre responde 200 pra Z-API não ficar reenviando o mesmo evento
    res.status(200).json({ ok: false, error: err.message });
  }
}

module.exports = {
  handleWebhook,
  pausarBot,
  retomarBot,
  isPausado,
  telefonesIguais,
};
