/**
 * routes/whatsappBot.js — Bot de atendimento via WhatsApp (Z-API)
 * Oh Barbeiro
 *
 * Fluxo:
 *  - Cliente com agendamento futuro → mostra a "comanda" e oferece Remarcar/Cancelar
 *  - Cliente sem agendamento (ou número novo) → manda o link do site para marcar
 *  - Remarcar mantém o mesmo serviço/barbeiro, só pede novo dia/horário
 *  - /pausar e /retomar funcionam a qualquer momento
 */

const { dbGet, dbSet } = require('../firebase');

// ─── LINK DO SITE DE AGENDAMENTO ────────────────────────────────────────────────
const LINK_SITE = 'https://ohbarbeiro23.github.io/OHBARBEIRO/';

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
// Comparamos pelos últimos 8 dígitos (o número "puro", sem DDD/DDI/9º dígito extra)
// porque cliente pode digitar o telefone de formatos bem diferentes no site:
// "83996529337", "(83) 99652-9337", "8396529337" (sem o 9 extra), etc.
function ultimosDigitos(telefone, n = 8) {
  const digitos = (telefone || '').replace(/\D/g, '');
  return digitos.slice(-n);
}

function telefonesIguais(a, b) {
  const da = ultimosDigitos(a);
  const db = ultimosDigitos(b);
  if (!da || !db) return false;
  return da === db;
}

// ─── SESSÕES DE CONVERSA (estado por telefone) ──────────────────────────────────
async function getSessao(telefone) {
  const sessoes = await dbGet('whatsapp_sessoes') || {};
  const chave = ultimosDigitos(telefone);
  return sessoes[chave] || { step: 'inicio' };
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

// ─── HELPERS DE DATA ─────────────────────────────────────────────────────────────
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function hojeISO() {
  return new Date().toISOString().split('T')[0];
}

function addDias(dataISO, n) {
  const d = new Date(dataISO + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDataCurta(dataISO) {
  const d = new Date(dataISO + 'T00:00:00');
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${DIAS_SEMANA[d.getDay()]} ${dia}/${mes}`;
}

function proximosDias(n = 7) {
  const lista = [];
  for (let i = 0; i < n; i++) lista.push(addDias(hojeISO(), i));
  return lista;
}

// ─── HORÁRIOS (mesma lógica do index.html) ───────────────────────────────────────
async function gerarSlotsDia() {
  const h = await dbGet('horarios') || {};
  const slots = [];
  const ini = parseInt((h.abertura || '08:00').split(':')[0]);
  const fim = parseInt((h.fechamento || '18:00').split(':')[0]);
  const intervalo = h.intervalo || 30;
  const bloqueados = h.bloqueados || [];
  for (let hr = ini; hr < fim; hr++) {
    const t0 = `${String(hr).padStart(2, '0')}:00`;
    if (!bloqueados.includes(t0)) slots.push(t0);
    if (intervalo <= 30) {
      const t1 = `${String(hr).padStart(2, '0')}:30`;
      if (!bloqueados.includes(t1)) slots.push(t1);
    }
  }
  return slots;
}

async function horariosOcupados(dataISO, barbeiroId) {
  const agendamentos = await dbGet('agendamentos') || [];
  return agendamentos
    .filter(a => a.data === dataISO && a.status !== 'cancelado' && a.barbeiroId === barbeiroId)
    .map(a => a.horario || a.hora);
}

async function horariosLivres(dataISO, barbeiroId) {
  const todos = await gerarSlotsDia();
  const ocupados = await horariosOcupados(dataISO, barbeiroId);
  return todos.filter(t => !ocupados.includes(t));
}

async function agendamentosFuturos(telefone) {
  const agendamentos = await dbGet('agendamentos') || [];
  const hoje = hojeISO();
  return agendamentos
    .filter(a => telefonesIguais(a.telefone, telefone) && a.status !== 'cancelado' && a.data >= hoje)
    .sort((a, b) => (a.data + (a.horario || a.hora || '')).localeCompare(b.data + (b.horario || b.hora || '')));
}

function fmtComanda(a) {
  const svc = (a.svcNomes || []).join(', ') || 'Serviço';
  return `${svc} — ${fmtDataCurta(a.data)} às ${a.horario || a.hora}, com ${a.barbeiro || 'barbeiro'}`;
}

async function buscarCliente(telefone) {
  const clientes = await dbGet('clientes') || [];
  return clientes.find(c => telefonesIguais(c.telefone, telefone)) || null;
}

// ─── PROCESSAMENTO DA MENSAGEM RECEBIDA ─────────────────────────────────────────
async function processarMensagem(telefone, textoRecebido) {
  const texto = (textoRecebido || '').trim();
  const textoLower = texto.toLowerCase();

  if (textoLower === '/pausar') {
    await pausarBot(telefone, 'comando');
    await enviarTexto(telefone, '🔇 Bot pausado para esta conversa. Vou parar de responder automaticamente. Mande */retomar* quando quiser que eu volte.');
    return;
  }
  if (textoLower === '/retomar') {
    await retomarBot(telefone);
    await limparSessao(telefone);
    await enviarTexto(telefone, '🔊 Bot reativado!');
    await iniciarConversa(telefone);
    return;
  }

  if (await isPausado(telefone)) return;

  const sessao = await getSessao(telefone);

  switch (sessao.step) {
    case 'pos_comanda':
      await tratarPosComanda(telefone, texto, sessao);
      break;
    case 'remarcar_data':
      await tratarRemarcarData(telefone, texto, sessao);
      break;
    case 'remarcar_hora':
      await tratarRemarcarHora(telefone, texto, sessao);
      break;
    case 'remarcar_confirmar':
      await tratarRemarcarConfirmar(telefone, texto, sessao);
      break;
    case 'cancelar_confirmar':
      await tratarCancelarConfirmar(telefone, texto, sessao);
      break;
    case 'sem_agendamento':
      await tratarSemAgendamento(telefone, texto, sessao);
      break;

    case 'inicio':
    default:
      await iniciarConversa(telefone);
      break;
  }
}

// ═══════════════════════════════════════════════════════════
// PORTA DE ENTRADA — identifica o cliente e decide o caminho
// ═══════════════════════════════════════════════════════════

async function iniciarConversa(telefone) {
  const cliente = await buscarCliente(telefone);
  const nome = cliente?.nome ? cliente.nome.split(' ')[0] : null;
  const futuros = await agendamentosFuturos(telefone);

  if (futuros.length > 0) {
    const ag = futuros[0];
    await setSessao(telefone, { step: 'pos_comanda', agendamentoId: ag.id });
    await enviarTexto(
      telefone,
      `Olá${nome ? ', ' + nome : ''}! 👋\n\n` +
      `📋 *Sua comanda:*\n${fmtComanda(ag)}\n\n` +
      `*1* - Remarcar\n` +
      `*2* - Cancelar\n` +
      `*3* - Está tudo certo, era só isso`
    );
    return;
  }

  if (cliente) {
    await setSessao(telefone, { step: 'sem_agendamento' });
    await enviarTexto(
      telefone,
      `Olá${nome ? ', ' + nome : ''}! Tudo bem? 👋\n\n` +
      `Pra marcar um horário, é só acessar nosso site:\n🔗 ${LINK_SITE}\n\n` +
      `Se quiser falar com um atendente, digite *4*.`
    );
    return;
  }

  await setSessao(telefone, { step: 'sem_agendamento' });
  await enviarTexto(
    telefone,
    `Olá! 👋 Bem-vindo à *Oh Barbeiro*!\n\n` +
    `Pra marcar seu horário, acesse nosso site:\n🔗 ${LINK_SITE}\n\n` +
    `Se quiser falar com um atendente, digite *4*.`
  );
}

async function tratarSemAgendamento(telefone, texto, sessao) {
  if (texto.trim() === '4') {
    await pausarBot(telefone, 'cliente_pediu_atendente');
    await enviarTexto(telefone, '👤 Combinado! Um atendente vai te responder por aqui em breve. Se quiser voltar a falar com o bot, é só mandar */retomar*.');
    return;
  }
  await enviarTexto(telefone, `Pra marcar um horário, acesse:\n🔗 ${LINK_SITE}\n\nOu digite *4* para falar com um atendente.`);
}

// ═══════════════════════════════════════════════════════════
// CLIENTE COM AGENDAMENTO — opções da comanda
// ═══════════════════════════════════════════════════════════

async function tratarPosComanda(telefone, texto, sessao) {
  const escolha = texto.trim();
  const agendamentos = await dbGet('agendamentos') || [];
  const ag = agendamentos.find(a => a.id === sessao.agendamentoId);

  if (!ag) {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Esse agendamento não foi encontrado (pode já ter sido alterado).');
    return;
  }

  if (escolha === '1') {
    const dias = proximosDias(7);
    await setSessao(telefone, {
      step: 'remarcar_data',
      agendamentoId: ag.id,
      servicosEscolhidos: ag.servicos,
      servicosNomes: ag.svcNomes,
      barbeiroId: ag.barbeiroId,
      barbeiroNome: ag.barbeiro,
      clienteNome: ag.clienteNome,
      diasDisponiveis: dias,
    });
    const lista = dias.map((d, i) => `*${i + 1}* - ${fmtDataCurta(d)}`).join('\n');
    await enviarTexto(telefone, `📅 Para qual novo dia você quer remarcar?\n\n${lista}`);
    return;
  }

  if (escolha === '2') {
    await setSessao(telefone, { step: 'cancelar_confirmar', agendamentoId: ag.id });
    await enviarTexto(
      telefone,
      `Confirma o cancelamento de:\n\n${fmtComanda(ag)}\n\n*1* - Sim, cancelar\n*2* - Não, manter`
    );
    return;
  }

  if (escolha === '3') {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Combinado! Até lá 😊');
    return;
  }

  await enviarTexto(telefone, 'Não entendi. Digite *1* (Remarcar), *2* (Cancelar) ou *3* (Está tudo certo).');
}

// ═══════════════════════════════════════════════════════════
// FLUXO: REMARCAR (mesmo serviço/barbeiro, novo dia/hora)
// ═══════════════════════════════════════════════════════════

async function tratarRemarcarData(telefone, texto, sessao) {
  const idx = parseInt(texto.trim());
  const dataEscolhida = (sessao.diasDisponiveis || [])[idx - 1];

  if (!dataEscolhida) {
    await enviarTexto(telefone, 'Não entendi. Digite o número do dia da lista.');
    return;
  }

  const livres = await horariosLivres(dataEscolhida, sessao.barbeiroId);
  if (livres.length === 0) {
    await enviarTexto(telefone, `Não há horários livres em ${fmtDataCurta(dataEscolhida)} com ${sessao.barbeiroNome}. Escolha outro dia da lista anterior.`);
    return;
  }

  const lista = livres.map((t, i) => `*${i + 1}* - ${t}`).join('\n');
  await setSessao(telefone, { ...sessao, step: 'remarcar_hora', dataEscolhida, horariosDisponiveis: livres });
  await enviarTexto(telefone, `🕐 Horários livres em ${fmtDataCurta(dataEscolhida)}:\n\n${lista}`);
}

async function tratarRemarcarHora(telefone, texto, sessao) {
  const idx = parseInt(texto.trim());
  const horaEscolhida = (sessao.horariosDisponiveis || [])[idx - 1];

  if (!horaEscolhida) {
    await enviarTexto(telefone, 'Não entendi. Digite o número do horário da lista.');
    return;
  }

  const novaSessao = { ...sessao, step: 'remarcar_confirmar', horaEscolhida };
  await setSessao(telefone, novaSessao);
  await enviarTexto(
    telefone,
    `📋 *Confirma a remarcação?*\n\n` +
    `${(sessao.servicosNomes || []).join(', ')}\n` +
    `${fmtDataCurta(sessao.dataEscolhida)} às ${horaEscolhida}, com ${sessao.barbeiroNome}\n\n` +
    `*1* - Confirmar ✅\n*2* - Cancelar ❌`
  );
}

async function tratarRemarcarConfirmar(telefone, texto, sessao) {
  const escolha = texto.trim();

  if (escolha === '2') {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Tudo bem, remarcação cancelada. Seu agendamento original continua valendo.');
    return;
  }

  if (escolha !== '1') {
    await enviarTexto(telefone, 'Digite *1* para confirmar ou *2* para cancelar a remarcação.');
    return;
  }

  const livres = await horariosLivres(sessao.dataEscolhida, sessao.barbeiroId);
  if (!livres.includes(sessao.horaEscolhida)) {
    await limparSessao(telefone);
    await enviarTexto(telefone, '⚠️ Esse horário acabou de ser ocupado. Digite qualquer mensagem pra ver sua comanda e tentar de novo.');
    return;
  }

  const agendamentos = await dbGet('agendamentos') || [];
  const idx = agendamentos.findIndex(a => a.id === sessao.agendamentoId);

  if (idx < 0) {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Esse agendamento não foi encontrado (pode já ter sido alterado).');
    return;
  }

  agendamentos[idx].data = sessao.dataEscolhida;
  agendamentos[idx].hora = sessao.horaEscolhida;
  agendamentos[idx].horario = sessao.horaEscolhida;
  await dbSet('agendamentos', agendamentos);

  await limparSessao(telefone);
  await enviarTexto(
    telefone,
    `✅ Remarcado com sucesso!\n\n${fmtDataCurta(sessao.dataEscolhida)} às ${sessao.horaEscolhida}, com ${sessao.barbeiroNome}\n\nTe esperamos! ✂️💈`
  );
}

// ═══════════════════════════════════════════════════════════
// FLUXO: CANCELAR (a partir da comanda)
// ═══════════════════════════════════════════════════════════

async function tratarCancelarConfirmar(telefone, texto, sessao) {
  const escolha = texto.trim();

  if (escolha === '2') {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Tudo certo, seu agendamento foi mantido. 👍');
    return;
  }

  if (escolha !== '1') {
    await enviarTexto(telefone, 'Digite *1* para confirmar o cancelamento ou *2* para manter.');
    return;
  }

  const agendamentos = await dbGet('agendamentos') || [];
  const idx = agendamentos.findIndex(a => a.id === sessao.agendamentoId);

  if (idx < 0) {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Esse agendamento não foi encontrado (pode já ter sido alterado).');
    return;
  }

  agendamentos[idx].status = 'cancelado';
  await dbSet('agendamentos', agendamentos);

  await limparSessao(telefone);
  await enviarTexto(telefone, `✅ Agendamento cancelado. Se quiser marcar outro horário, acesse:\n🔗 ${LINK_SITE}`);
}

// ─── WEBHOOK (chamado pela Z-API a cada mensagem recebida) ──────────────────────
async function handleWebhook(req, res) {
  try {
    const body = req.body || {};

    if (body.fromMe) return res.json({ ok: true, ignorado: 'mensagem própria' });
    if (body.isGroup) return res.json({ ok: true, ignorado: 'mensagem de grupo' });
    if (!body.phone || !body.text || !body.text.message) {
      return res.json({ ok: true, ignorado: 'evento sem texto' });
    }

    await processarMensagem(body.phone, body.text.message);
    res.json({ ok: true });
  } catch (err) {
    console.error('[whatsappBot] Erro no webhook:', err.message);
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
