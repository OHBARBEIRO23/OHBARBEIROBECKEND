/**
 * routes/cobranca.js — Cobrança automática de assinaturas via WhatsApp (Z-API)
 * Oh Barbeiro
 *
 * Disparado pelo cron no server.js todo dia às 09h.
 */

const { dbGet, dbSet } = require('../firebase');

// ─── CONFIG Z-API (variáveis no .env) ──────────────────────────────────────────
const ZAPI_BASE = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;
const ZAPI_HEADERS = {
  'Content-Type': 'application/json',
  'Client-Token': process.env.ZAPI_CLIENT_TOKEN,
};

// Dias ANTES do vencimento para avisar
const AVISOS_ANTES = [3, 1];
// Dias APÓS o vencimento para cobrar inadimplente
const COBRAR_APOS  = [1, 3];


// ─── MENSAGENS ─────────────────────────────────────────────────────────────────

function msgAviso(nome, diasRestantes, dataVenc, valor, pixChave) {
  const plural = diasRestantes === 1 ? 'dia' : 'dias';
  return (
    `Olá, *${nome}*! ✂️\n\n` +
    `Sua assinatura da barbearia vence em *${diasRestantes} ${plural}* (dia ${dataVenc}).\n` +
    `Valor: *R$ ${valor}*\n\n` +
    `Para renovar, é só pagar via Pix:\n` +
    `🔑 Chave: *${pixChave}*\n\n` +
    `Qualquer dúvida é só chamar! 😊`
  );
}

function msgVenceHoje(nome, dataVenc, valor, pixChave) {
  return (
    `Olá, *${nome}*! ✂️\n\n` +
    `Hoje é o dia do vencimento da sua assinatura (${dataVenc}).\n` +
    `Valor: *R$ ${valor}*\n\n` +
    `Pague via Pix para manter seu plano ativo:\n` +
    `🔑 Chave: *${pixChave}*\n\n` +
    `Obrigado pela preferência! 🙏`
  );
}

function msgInadimplente(nome, diasAtraso, valor, pixChave) {
  const plural = diasAtraso === 1 ? 'dia' : 'dias';
  return (
    `Olá, *${nome}*! ✂️\n\n` +
    `Notamos que sua assinatura está em aberto há *${diasAtraso} ${plural}*.\n` +
    `Valor: *R$ ${valor}*\n\n` +
    `Para não perder os benefícios do seu plano, regularize via Pix:\n` +
    `🔑 Chave: *${pixChave}*\n\n` +
    `Qualquer problema pode nos chamar, estamos aqui! 💈`
  );
}


// ─── ENVIO VIA Z-API ───────────────────────────────────────────────────────────

async function enviarWhatsApp(telefone, mensagem) {
  const numero = telefone.replace(/\D/g, ''); // só números

  const resp = await fetch(`${ZAPI_BASE}/send-text`, {
    method: 'POST',
    headers: ZAPI_HEADERS,
    body: JSON.stringify({ phone: numero, message: mensagem }),
  });

  const json = await resp.json();
  if (!resp.ok) throw new Error(`Z-API erro: ${JSON.stringify(json)}`);
  return json;
}


// ─── LÓGICA PRINCIPAL ──────────────────────────────────────────────────────────

async function checkAndSendCobrancas() {
  console.log(`[cobranca] Iniciando — ${new Date().toLocaleString('pt-BR')}`);

  // Busca chave Pix nas configurações gerais do sistema
  const configGeral = await dbGet('config') || {};
  const pixChave = configGeral.pix || 'consulte a barbearia';

  const assinaturas = await dbGet('assinaturas') || [];
  const clientes    = await dbGet('clientes')    || [];

  if (assinaturas.length === 0) {
    console.log('[cobranca] Nenhuma assinatura cadastrada.');
    return;
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // Histórico evita reenvio no mesmo dia para o mesmo evento
  const historico = await dbGet('cobranca_historico') || {};

  let enviados = 0;
  let erros    = 0;

  for (const ass of assinaturas) {
    try {
      if (ass.status === 'inativo') continue;

      const cliente = clientes.find(c => c.id === ass.clienteId);
      if (!cliente) {
        console.warn(`[cobranca] Cliente não encontrado para assinatura ${ass.id}`);
        continue;
      }

      const telefone = cliente.telefone || cliente.whatsapp;
      if (!telefone) {
        console.warn(`[cobranca] ${cliente.nome} sem telefone — pulando`);
        continue;
      }

      const nome     = cliente.nome || 'Cliente';
      const dataVenc = new Date(ass.dataVencimento + 'T00:00:00');
      dataVenc.setHours(0, 0, 0, 0);

      const diffDias = Math.round((dataVenc - hoje) / (1000 * 60 * 60 * 24));
      const dataFormatada = dataVenc.toLocaleDateString('pt-BR');
      const valor = Number(ass.valor || 0).toFixed(2).replace('.', ',');

      // Chave única por assinatura + dia + evento
      const chaveHist = `${ass.id}_${hoje.toISOString().split('T')[0]}_${diffDias}`;
      if (historico[chaveHist]) continue; // já enviado hoje

      let mensagem = null;

      if (diffDias === 0) {
        mensagem = msgVenceHoje(nome, dataFormatada, valor, pixChave);
      } else if (AVISOS_ANTES.includes(diffDias)) {
        mensagem = msgAviso(nome, diffDias, dataFormatada, valor, pixChave);
      } else if (COBRAR_APOS.includes(-diffDias)) {
        mensagem = msgInadimplente(nome, -diffDias, valor, pixChave);
      }

      if (!mensagem) continue;

      await enviarWhatsApp(telefone, mensagem);
      historico[chaveHist] = new Date().toISOString();
      enviados++;
      console.log(`[cobranca] ✅ ${nome} (${telefone}) diff=${diffDias}d`);

      // Pausa de 2s entre mensagens para não ser bloqueado
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      erros++;
      console.error(`[cobranca] ❌ Assinatura ${ass.id}:`, err.message);
    }
  }

  // Salva histórico e limpa entradas antigas (> 30 dias)
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() - 30);
  for (const chave of Object.keys(historico)) {
    if (new Date(historico[chave]) < limite) delete historico[chave];
  }
  await dbSet('cobranca_historico', historico);

  console.log(`[cobranca] Concluído — ${enviados} enviados, ${erros} erros`);
}

// ─── ENVIO MANUAL PARA UM ASSINANTE ESPECÍFICO (botão no painel) ──────────────

async function enviarCobrancaManual(assinaturaId) {
  const configGeral = await dbGet('config') || {};
  const pixChave = configGeral.pix || 'consulte a barbearia';

  const assinaturas = await dbGet('assinaturas') || [];
  const clientes    = await dbGet('clientes')    || [];

  const ass = assinaturas.find(a => a.id === assinaturaId);
  if (!ass) throw new Error('Assinatura não encontrada.');

  const cliente = clientes.find(c => c.id === ass.clienteId);
  if (!cliente) throw new Error('Cliente não encontrado.');

  const telefone = cliente.telefone || cliente.whatsapp;
  if (!telefone) throw new Error(`${cliente.nome} não tem telefone cadastrado.`);

  const nome     = cliente.nome || 'Cliente';
  const hoje     = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataVenc = new Date(ass.dataVencimento + 'T00:00:00');
  dataVenc.setHours(0, 0, 0, 0);

  const diffDias = Math.round((dataVenc - hoje) / (1000 * 60 * 60 * 24));
  const dataFormatada = dataVenc.toLocaleDateString('pt-BR');
  const valor = Number(ass.valor || 0).toFixed(2).replace('.', ',');

  let mensagem;
  if (diffDias > 0) {
    mensagem = msgAviso(nome, diffDias, dataFormatada, valor, pixChave);
  } else if (diffDias === 0) {
    mensagem = msgVenceHoje(nome, dataFormatada, valor, pixChave);
  } else {
    mensagem = msgInadimplente(nome, -diffDias, valor, pixChave);
  }

  await enviarWhatsApp(telefone, mensagem);

  return { cliente: nome, telefone, diffDias };
}

module.exports = { checkAndSendCobrancas, enviarCobrancaManual };
