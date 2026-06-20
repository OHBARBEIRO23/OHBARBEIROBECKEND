/**
 * routes/whatsappBot.js — Bot de agendamento via WhatsApp (Z-API)
 * Oh Barbeiro
 *
 * Etapas prontas: menu principal, pausar/retomar, marcar horário (completo).
 * Pendente: ver agendamentos, cancelar agendamento.
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

// Próximos N dias a partir de hoje (incluindo hoje), pra oferecer como opção
function proximosDias(n = 7) {
  const lista = [];
  for (let i = 0; i < n; i++) lista.push(addDias(hojeISO(), i));
  return lista;
}

// ─── SERVIÇOS / BARBEIROS / HORÁRIOS (mesma lógica do index.html) ───────────────
async function listarServicosAtivos() {
  const servicos = await dbGet('servicos') || [];
  return servicos.filter(s => s.status === 'ativo');
}

async function listarBarbeirosAtivos() {
  const barbeiros = await dbGet('barbeiros') || [];
  return barbeiros.filter(b => b.status === 'ativo');
}

// Gera os horários fixos do dia (08:00, 08:30...) a partir de config/horarios
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

// Horários já ocupados naquele dia, pra aquele barbeiro (mesma regra do index.html)
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
    case 'marcar_servico':
      await tratarMarcarServico(telefone, texto, sessao);
      break;
    case 'marcar_barbeiro':
      await tratarMarcarBarbeiro(telefone, texto, sessao);
      break;
    case 'marcar_data':
      await tratarMarcarData(telefone, texto, sessao);
      break;
    case 'marcar_hora':
      await tratarMarcarHora(telefone, texto, sessao);
      break;
    case 'marcar_nome':
      await tratarMarcarNome(telefone, texto, sessao);
      break;
    case 'marcar_confirmar':
      await tratarMarcarConfirmar(telefone, texto, sessao);
      break;

    case 'menu':
    default:
      await tratarMenuPrincipal(telefone, texto);
      break;
  }
}

async function tratarMenuPrincipal(telefone, texto) {
  switch (texto) {
    case '1':
      await iniciarMarcacao(telefone);
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

// ═══════════════════════════════════════════════════════════
// FLUXO: MARCAR HORÁRIO
// ═══════════════════════════════════════════════════════════

async function iniciarMarcacao(telefone) {
  const servicos = await listarServicosAtivos();
  if (servicos.length === 0) {
    await enviarTexto(telefone, 'No momento não há serviços disponíveis para agendamento. Tente novamente mais tarde ou digite *4* para falar com um atendente.');
    return;
  }

  const lista = servicos.map((s, i) => `*${i + 1}* - ${s.nome}${s.preco ? ` (R$ ${Number(s.preco).toFixed(2).replace('.', ',')})` : ''}`).join('\n');

  await setSessao(telefone, { step: 'marcar_servico', servicosDisponiveis: servicos.map(s => s.id) });
  await enviarTexto(
    telefone,
    `✂️ Qual serviço você deseja?\n\n${lista}\n\nVocê pode escolher mais de um, separado por vírgula (ex: 1,3).`
  );
}

async function tratarMarcarServico(telefone, texto, sessao) {
  const servicos = await listarServicosAtivos();
  const indices = texto.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

  const escolhidos = indices
    .map(i => servicos[i - 1])
    .filter(Boolean);

  if (escolhidos.length === 0) {
    await enviarTexto(telefone, 'Não entendi a escolha. Digite o(s) número(s) do(s) serviço(s), ex: *1* ou *1,3*.');
    return;
  }

  const barbeiros = await listarBarbeirosAtivos();
  if (barbeiros.length === 0) {
    await enviarTexto(telefone, 'No momento não há barbeiros disponíveis. Digite *4* para falar com um atendente.');
    await limparSessao(telefone);
    return;
  }

  const lista = barbeiros.map((b, i) => `*${i + 1}* - ${b.nome}`).join('\n');

  await setSessao(telefone, {
    step: 'marcar_barbeiro',
    servicosEscolhidos: escolhidos.map(s => s.id),
    servicosNomes: escolhidos.map(s => s.nome),
  });
  await enviarTexto(telefone, `💈 Com qual barbeiro você quer marcar?\n\n${lista}`);
}

async function tratarMarcarBarbeiro(telefone, texto, sessao) {
  const barbeiros = await listarBarbeirosAtivos();
  const idx = parseInt(texto.trim());
  const barbeiro = barbeiros[idx - 1];

  if (!barbeiro) {
    await enviarTexto(telefone, 'Não entendi. Digite o número do barbeiro da lista.');
    return;
  }

  const dias = proximosDias(7);
  const lista = dias.map((d, i) => `*${i + 1}* - ${fmtDataCurta(d)}`).join('\n');

  await setSessao(telefone, {
    ...sessao,
    step: 'marcar_data',
    barbeiroId: barbeiro.id,
    barbeiroNome: barbeiro.nome,
    diasDisponiveis: dias,
  });
  await enviarTexto(telefone, `📅 Para qual dia você quer marcar?\n\n${lista}`);
}

async function tratarMarcarData(telefone, texto, sessao) {
  const idx = parseInt(texto.trim());
  const dataEscolhida = (sessao.diasDisponiveis || [])[idx - 1];

  if (!dataEscolhida) {
    await enviarTexto(telefone, 'Não entendi. Digite o número do dia da lista.');
    return;
  }

  const livres = await horariosLivres(dataEscolhida, sessao.barbeiroId);

  if (livres.length === 0) {
    await enviarTexto(telefone, `Poxa, não há mais horários livres em ${fmtDataCurta(dataEscolhida)} com ${sessao.barbeiroNome}. Escolha outro dia (digite o número da lista anterior) ou digite *0* para recomeçar.`);
    return;
  }

  const lista = livres.map((t, i) => `*${i + 1}* - ${t}`).join('\n');

  await setSessao(telefone, {
    ...sessao,
    step: 'marcar_hora',
    dataEscolhida,
    horariosDisponiveis: livres,
  });
  await enviarTexto(telefone, `🕐 Horários livres em ${fmtDataCurta(dataEscolhida)}:\n\n${lista}`);
}

async function tratarMarcarHora(telefone, texto, sessao) {
  if (texto.trim() === '0') {
    await iniciarMarcacao(telefone);
    return;
  }

  const idx = parseInt(texto.trim());
  const horaEscolhida = (sessao.horariosDisponiveis || [])[idx - 1];

  if (!horaEscolhida) {
    await enviarTexto(telefone, 'Não entendi. Digite o número do horário da lista, ou *0* para recomeçar.');
    return;
  }

  // Confere se já existe um nome salvo desse telefone em algum agendamento anterior
  const agendamentos = await dbGet('agendamentos') || [];
  const anterior = agendamentos.find(a => telefonesIguais(a.telefone, telefone));

  if (anterior && anterior.clienteNome) {
    const novaSessao = { ...sessao, step: 'marcar_confirmar', horaEscolhida, clienteNome: anterior.clienteNome };
    await setSessao(telefone, novaSessao);
    await enviarResumoConfirmacao(telefone, novaSessao);
  } else {
    await setSessao(telefone, { ...sessao, step: 'marcar_nome', horaEscolhida });
    await enviarTexto(telefone, '✍️ Pra finalizar, qual é o seu nome?');
  }
}

async function tratarMarcarNome(telefone, texto, sessao) {
  const nome = texto.trim();
  if (nome.length < 2) {
    await enviarTexto(telefone, 'Digite seu nome completo, por favor.');
    return;
  }

  const novaSessao = { ...sessao, step: 'marcar_confirmar', clienteNome: nome };
  await setSessao(telefone, novaSessao);
  await enviarResumoConfirmacao(telefone, novaSessao);
}

async function enviarResumoConfirmacao(telefone, sessao) {
  const resumo =
    `📋 *Confirme seu agendamento:*\n\n` +
    `Serviço(s): ${(sessao.servicosNomes || []).join(', ')}\n` +
    `Barbeiro: ${sessao.barbeiroNome}\n` +
    `Data: ${fmtDataCurta(sessao.dataEscolhida)}\n` +
    `Horário: ${sessao.horaEscolhida}\n` +
    `Nome: ${sessao.clienteNome}\n\n` +
    `*1* - Confirmar ✅\n` +
    `*2* - Cancelar ❌`;
  await enviarTexto(telefone, resumo);
}

async function tratarMarcarConfirmar(telefone, texto, sessao) {
  const escolha = texto.trim();

  if (escolha === '2') {
    await limparSessao(telefone);
    await enviarTexto(telefone, 'Agendamento cancelado. Se quiser marcar novamente, digite *1*.');
    return;
  }

  if (escolha !== '1') {
    await enviarTexto(telefone, 'Digite *1* para confirmar ou *2* para cancelar.');
    return;
  }

  // Revalida o horário ainda está livre (evita conflito se outro cliente marcou nesse meio tempo)
  const livres = await horariosLivres(sessao.dataEscolhida, sessao.barbeiroId);
  if (!livres.includes(sessao.horaEscolhida)) {
    await limparSessao(telefone);
    await enviarTexto(telefone, '⚠️ Esse horário acabou de ser ocupado por outra pessoa. Digite *1* para escolher outro horário.');
    return;
  }

  const agendamentos = await dbGet('agendamentos') || [];
  const novo = {
    id: 'ag' + Date.now(),
    clienteNome: sessao.clienteNome,
    nomeCliente: sessao.clienteNome,
    clienteId: '',
    telefone: telefone,
    servicos: sessao.servicosEscolhidos,
    svcNomes: sessao.servicosNomes,
    barbeiroId: sessao.barbeiroId,
    barbeiro: sessao.barbeiroNome,
    data: sessao.dataEscolhida,
    hora: sessao.horaEscolhida,
    horario: sessao.horaEscolhida,
    status: 'pendente',
    criado: hojeISO(),
    origem: 'whatsapp_bot',
  };
  agendamentos.push(novo);
  await dbSet('agendamentos', agendamentos);

  await limparSessao(telefone);
  await enviarTexto(
    telefone,
    `✅ Agendamento confirmado!\n\n` +
    `${fmtDataCurta(sessao.dataEscolhida)} às ${sessao.horaEscolhida}\n` +
    `Com ${sessao.barbeiroNome}\n\n` +
    `Te esperamos! ✂️💈`
  );
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
