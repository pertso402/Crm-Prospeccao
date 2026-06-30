import 'dotenv/config';
import { enviarTexto, enviarVideo } from './evolution.js';
import { gerarMensagemAbordagem, gerarFollowUp, classificarResposta } from './openai.js';
import {
  updateLead, logMensagem, agendarFollowUp,
  getLeadByWhatsapp, sessaoId, getConversa
} from './db.js';

const PETER = process.env.PETER_WHATSAPP;

// Delays em ms entre mensagens (humano digitando)
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const delayAleatorio = (min, max) => delay(min + Math.random() * (max - min));

// ── INICIAR ABORDAGEM ─────────────────────────────────────
// Chamado pelo scheduler quando um lead está pronto

export async function iniciarAbordagem(lead) {
  const { id, whatsapp, instancia_whatsapp, produto } = lead;
  const inst = instancia_whatsapp;
  const sid = sessaoId(id);

  console.log(`[agente] Iniciando abordagem: ${lead.nome_negocio} via ${inst}`);

  try {
    // 1. Saudação inicial (varia pra reduzir fingerprint de spam)
    const saudacoes = ['Boa tarde', 'Oi, boa tarde', 'Boa tarde!', 'Olá, boa tarde'];
    const saudacao = saudacoes[Math.floor(Math.random() * saudacoes.length)];
    await enviarTexto(inst, whatsapp, saudacao);
    await logMensagem({ lead_id: id, sessao_id: sid, remetente: 'ia', mensagem: saudacao, stage_no_momento: 'novo' });

    await updateLead(id, {
      stage: 'abordagem_enviada',
      ultimo_contato: new Date().toISOString(),
    });

    // A partir daqui o agente reage via webhook (processarResposta)
    // Agendamos um follow-up caso não haja resposta em 1h
    const fu1 = new Date(Date.now() + 60 * 60 * 1000); // +1h
    await agendarFollowUp(id, 'frio_1', fu1.toISOString());

  } catch (err) {
    console.error(`[agente] Erro na abordagem de ${lead.nome_negocio}:`, err.message);
  }
}

// ── PROCESSAR RESPOSTA DO LEAD ────────────────────────────
// Chamado pelo webhook quando chega mensagem de um número conhecido

export async function processarResposta(numeroLead, mensagemTexto) {
  const lead = await getLeadByWhatsapp(numeroLead);
  if (!lead) {
    console.log(`[agente] Número desconhecido: ${numeroLead}`);
    return;
  }

  // Se Peter assumiu a conversa, apenas loga a mensagem do lead
  if (lead.conversa_pausada || lead.assumido_por_humano) {
    await logMensagem({
      lead_id: lead.id,
      sessao_id: sessaoId(lead.id),
      remetente: 'lead',
      mensagem: mensagemTexto,
      stage_no_momento: lead.stage,
    });
    return;
  }

  const inst = lead.instancia_whatsapp;
  const sid = sessaoId(lead.id);

  // Loga a mensagem do lead
  await logMensagem({
    lead_id: lead.id,
    sessao_id: sid,
    remetente: 'lead',
    mensagem: mensagemTexto,
    stage_no_momento: lead.stage,
  });

  const pitchEnviado = lead.stage === 'abordagem_enviada' || (lead.tentativas_followup || 0) > 0;
  const aguardandoDono = lead.stage === 'aguardando_decisor';
  const ultimaPerguntas = lead.conversa_estado || null;

  // Últimas mensagens para contexto
  const { getConversa } = await import('./db.js');
  const conv = await getConversa(lead.id);
  const historico = conv.slice(-6).map(m => ({ role: m.remetente === 'lead' ? 'lead' : 'ia', texto: m.mensagem }));

  const intencao = await classificarResposta(mensagemTexto, { pitchEnviado, aguardandoDono, ultimaPerguntas, historico });
  console.log(`[agente] ${lead.nome_negocio} → ${intencao}: "${mensagemTexto.slice(0, 60)}"`);

  // ── BOT detectado ──────────────────────────────────────
  if (intencao === 'BOT') {
    await delayAleatorio(3000, 7000);
    const resposta = 'Oii tudo bem? Eu falo com o dono(a)?';
    await enviarTexto(inst, lead.whatsapp, resposta);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
    await updateLead(lead.id, { bot_detectado: true, conversa_estado: 'dono' });
    return;
  }

  // ── ATENDEU (saudação genérica — alguém pegou) ────────
  if (intencao === 'ATENDEU') {
    await delayAleatorio(2000, 6000);
    const resposta = 'Oii tudo bem? Eu falo com o dono(a)?';
    await enviarTexto(inst, lead.whatsapp, resposta);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
    await updateLead(lead.id, { stage: 'aguardando_decisor', conversa_estado: 'dono' });
    return;
  }

  // ── OBJEÇÃO ───────────────────────────────────────────
  if (intencao === 'OBJECAO') {
    await delayAleatorio(3000, 7000);
    let resposta;
    if (pitchEnviado) {
      // Objeção depois do pitch — reframe direto
      resposta = 'Entendo! Na verdade a diferença não é ter ou não ter cardápio — é sobre o cliente sentir desejo antes de escolher. Um cardápio comum mostra o que tem. O que eu faço faz o cliente querer o item mais caro antes de colocar a mão no bolso. Vale o dono(a) dar uma olhada na prévia, é rápido e sem compromisso 😊';
    } else {
      // Objeção antes do pitch (atendente)
      resposta = 'Entendo! Na verdade é bem diferente do cardápio comum — é sobre transformar a experiência do cliente na hora de escolher. Posso mostrar rapidinho pro(a) dono(a)? Leva 2 minutinhos e fica a critério dele(a).';
    }
    await enviarTexto(inst, lead.whatsapp, resposta);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
    await updateLead(lead.id, { conversa_estado: 'dono' });
    return;
  }

  // ── PERGUNTA DO ATENDENTE ─────────────────────────────
  if (intencao === 'PERGUNTA_ATENDENTE') {
    await delayAleatorio(2000, 5000);
    const produto = lead.produto === 'agente_atendimento' ? 'agente de atendimento' : 'cardápio digital';
    const resposta = `É sobre um ${produto} pra vocês! Queria conversar rapidinho com o(a) dono(a) pra mostrar uma coisa bem bacana. Ele(a) se encontra?`;
    await enviarTexto(inst, lead.whatsapp, resposta);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
    await updateLead(lead.id, { conversa_estado: 'dono' });
    return;
  }

  // ── GATEKEEPER ────────────────────────────────────────
  if (intencao === 'GATEKEEPER') {
    await delayAleatorio(2000, 5000);
    if (aguardandoDono) {
      const resposta = 'Entendido! O dono costuma estar por aí em algum horário específico?';
      await enviarTexto(inst, lead.whatsapp, resposta);
      await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
      await updateLead(lead.id, { conversa_estado: 'horario_dono' });
    } else {
      const resposta = 'Oii tudo bem? Eu falo com o dono(a)?';
      await enviarTexto(inst, lead.whatsapp, resposta);
      await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
      await updateLead(lead.id, { stage: 'aguardando_decisor', conversa_estado: 'dono' });
    }
    return;
  }

  // ── RELAY — atendente vai repassar → envia pitch ao atendente ──
  if (intencao === 'RELAY') {
    await delayAleatorio(3000, 6000);
    const mensagem = await gerarMensagemAbordagem(lead);
    const videoUrl = lead.produto === 'agente_atendimento'
      ? process.env.VIDEO_MARMITARIA_URL
      : process.env.VIDEO_CARDAPIO_URL;

    if (videoUrl) {
      await enviarVideo(inst, lead.whatsapp, videoUrl, '');
      await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: '', midia_url: videoUrl, midia_tipo: 'video', stage_no_momento: lead.stage });
      await delayAleatorio(2000, 4000);
    }

    await enviarTexto(inst, lead.whatsapp, mensagem);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem, stage_no_momento: lead.stage });

    await delayAleatorio(1500, 3000);
    const followMsg = 'Amanhã vou entrar em contato de novo pra ver se ele(a) chegou a dar uma olhada 👍';
    await enviarTexto(inst, lead.whatsapp, followMsg);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: followMsg, stage_no_momento: lead.stage });

    await updateLead(lead.id, { stage: 'aguardando_decisor', ultimo_contato: new Date().toISOString(), tentativas_followup: 0 });
    await agendarSequenciaFollowUp(lead.id);
    return;
  }

  // ── HORARIO_DONO ──────────────────────────────────────
  if (intencao === 'HORARIO_DONO') {
    await delayAleatorio(2000, 4000);
    const resposta = 'Perfeito, obrigado! Vou entrar em contato no horário certo então 👍';
    await enviarTexto(inst, lead.whatsapp, resposta);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: resposta, stage_no_momento: lead.stage });
    await updateLead(lead.id, { stage: 'aguardando_decisor', conversa_estado: null, decisor_disponivel_em: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() });
    await agendarFollowUp(lead.id, 'decisor', new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString());
    return;
  }

  // ── DECISOR confirmado — envia mensagem + vídeo ────────
  if (intencao === 'DECISOR') {
    await delayAleatorio(4000, 9000);
    const mensagem = await gerarMensagemAbordagem(lead);
    const videoUrl = lead.produto === 'agente_atendimento'
      ? process.env.VIDEO_MARMITARIA_URL
      : process.env.VIDEO_CARDAPIO_URL;

    // Envia vídeo primeiro, depois mensagem (sequência natural)
    if (videoUrl) {
      await enviarVideo(inst, lead.whatsapp, videoUrl, '');
      await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: '', midia_url: videoUrl, midia_tipo: 'video', stage_no_momento: lead.stage });
      await delayAleatorio(3000, 6000);
    }

    await enviarTexto(inst, lead.whatsapp, mensagem);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem, stage_no_momento: lead.stage });

    await updateLead(lead.id, {
      stage: 'abordagem_enviada',
      ultimo_contato: new Date().toISOString(),
      tentativas_followup: 0,
    });

    // Cancela follow-ups anteriores e agenda nova sequência
    await agendarSequenciaFollowUp(lead.id);
    return;
  }

  // ── INTERESSE ──────────────────────────────────────────
  if (intencao === 'INTERESSE' || intencao === 'PERGUNTA') {
    await pausarEAcionar(lead, mensagemTexto, sid);
    return;
  }

  // ── SEM INTERESSE ──────────────────────────────────────
  if (intencao === 'SEM_INTERESSE') {
    await updateLead(lead.id, { stage: 'perdido' });
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'sistema', mensagem: 'Lead marcado como perdido (recusa explícita)', stage_no_momento: 'perdido' });
    return;
  }

  // ── NEUTRO — aguarda sem responder ────────────────────
  console.log(`[agente] Resposta neutra de ${lead.nome_negocio}, aguardando.`);
}

// ── EXECUTAR FOLLOW-UP ────────────────────────────────────

export async function executarFollowUp(followUp) {
  const lead = followUp.leads;
  if (!lead) return;
  if (lead.conversa_pausada || lead.assumido_por_humano) return;
  if (lead.stage === 'perdido' || lead.stage === 'fechado') return;

  const inst = lead.instancia_whatsapp;
  const sid = sessaoId(lead.id);
  const tentativa = (lead.tentativas_followup || 0) + 1;

  console.log(`[agente] Follow-up ${followUp.tipo} para ${lead.nome_negocio}`);

  // Follow-up pro decisor (ainda não chegou ao dono)
  if (followUp.tipo === 'decisor') {
    const msg = 'Oi! O dono(a) está disponível agora?';
    await enviarTexto(inst, lead.whatsapp, msg);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: msg, stage_no_momento: lead.stage });
    await updateLead(lead.id, { tentativas_followup: tentativa });
    return;
  }

  // Follow-up frio (sem resposta após abordagem)
  if (tentativa >= 4) {
    // 4ª tentativa — última
    const msg = await gerarFollowUp(lead, 3);
    await enviarTexto(inst, lead.whatsapp, msg);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: msg, stage_no_momento: lead.stage });
    await updateLead(lead.id, { stage: 'perdido', tentativas_followup: tentativa });
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'sistema', mensagem: 'Máximo de follow-ups atingido → perdido', stage_no_momento: 'perdido' });
  } else {
    const msg = await gerarFollowUp(lead, tentativa);
    await enviarTexto(inst, lead.whatsapp, msg);
    await logMensagem({ lead_id: lead.id, sessao_id: sid, remetente: 'ia', mensagem: msg, stage_no_momento: 'follow_up_frio' });
    await updateLead(lead.id, { stage: 'follow_up_frio', tentativas_followup: tentativa });
  }
}

// ── PAUSA + ACIONA PETER ──────────────────────────────────

async function pausarEAcionar(lead, ultimaMensagem, sid) {
  await updateLead(lead.id, {
    stage: 'interessado',
    conversa_pausada: true,
    assumido_por_humano: false,
    precisa_atencao: true,
    motivo_atencao: ultimaMensagem.slice(0, 200),
    atencao_em: new Date().toISOString(),
  });

  await logMensagem({
    lead_id: lead.id, sessao_id: sid, remetente: 'sistema',
    mensagem: '🔥 Lead sinalizou interesse — conversa pausada, aguardando Peter',
    stage_no_momento: 'interessado',
  });

  // Notifica Peter no WhatsApp pessoal
  const notif = `🔥 *INTERESSE DETECTADO*\n\n*${lead.nome_negocio}*\n${lead.segmento || ''}\n\nÚltima mensagem:\n"${ultimaMensagem}"\n\nAbra o painel ou assuma a conversa no WhatsApp.`;

  // Usa a primeira instância disponível para notificar
  const instNotif = lead.instancia_whatsapp || 'trimly';
  try {
    await enviarTexto(instNotif, PETER, notif);
  } catch (e) {
    console.error('[agente] Falha ao notificar Peter:', e.message);
  }
}

// ── SEQUÊNCIA DE FOLLOW-UPS ───────────────────────────────

async function agendarSequenciaFollowUp(lead_id) {
  const agora = Date.now();
  await agendarFollowUp(lead_id, 'frio_1', new Date(agora + 1 * 60 * 60 * 1000).toISOString());          // +1h
  await agendarFollowUp(lead_id, 'frio_2', new Date(agora + 24 * 60 * 60 * 1000).toISOString());         // +1 dia
  await agendarFollowUp(lead_id, 'frio_3', new Date(agora + 28 * 60 * 60 * 1000).toISOString());         // +1 dia 4h
  await agendarFollowUp(lead_id, 'frio_4', new Date(agora + 48 * 60 * 60 * 1000).toISOString());         // +2 dias
}
