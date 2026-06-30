// Roda a lógica do agente sem enviar nada pro WhatsApp
// Retorna o que o agente faria em cada etapa

import { gerarMensagemAbordagem, gerarFollowUp, classificarResposta } from './openai.js';

// Estado da simulação (por sessão de sim)
const sessoes = new Map();

export function criarSessao(id, lead) {
  sessoes.set(id, {
    lead,
    historico: [],   // { role: 'ia'|'peter'|'sistema', texto, ts }
    estagio: 'inicio',  // inicio → boa_tarde → aguardando_decisor → abordagem_enviada → fim
    botDetectado: false,
    decisorConfirmado: false,
    tentativasFollowUp: 0,
  });
  return sessoes.get(id);
}

export function getSessao(id) {
  return sessoes.get(id);
}

function log(sessao, role, texto, extra = {}) {
  sessao.historico.push({ role, texto, ts: new Date().toISOString(), ...extra });
}

// Simula o início da abordagem — retorna a primeira mensagem da IA
export async function simularInicio(sessaoId) {
  const s = sessoes.get(sessaoId);
  if (!s) throw new Error('Sessão não encontrada');

  log(s, 'sistema', `Lead: ${s.lead.nome_negocio} | Produto: ${s.lead.produto || 'cardapio'} | Instância: ${s.lead.instancia_whatsapp || 'trimly'}`);

  const msgs = [{ role: 'ia', texto: 'Boa tarde' }];
  log(s, 'ia', 'Boa tarde');
  s.estagio = 'boa_tarde';

  return msgs;
}

// Processa uma mensagem de Peter no simulador e retorna respostas da IA
export async function simularResposta(sessaoId, mensagemPeter) {
  const s = sessoes.get(sessaoId);
  if (!s) throw new Error('Sessão não encontrada');

  log(s, 'peter', mensagemPeter);

  const respostas = [];

  const pitchEnviado = s.decisorConfirmado;
  const aguardandoDono = s.estagio === 'aguardando_dono' || s.estagio === 'perguntando_horario';
  const ultimaPerguntas = s.estagio === 'aguardando_dono' ? 'dono'
    : s.estagio === 'perguntando_horario' ? 'horario_dono'
    : s.decisorConfirmado ? 'pitch'
    : null;
  const historico = s.historico
    .filter(m => m.role === 'ia' || m.role === 'peter')
    .slice(-6)
    .map(m => ({ role: m.role === 'peter' ? 'lead' : 'ia', texto: m.texto }));

  const intencao = await classificarResposta(mensagemPeter, { pitchEnviado, aguardandoDono, ultimaPerguntas, historico });
  console.log(`[sim] estagio=${s.estagio} pitchEnviado=${pitchEnviado} → ${intencao}`);

  // ── ATENDEU (alguém pegou com saudação genérica) ─────
  if (intencao === 'ATENDEU') {
    const r = 'Oii tudo bem? Eu falo com o dono(a)?';
    log(s, 'ia', r);
    respostas.push({ role: 'ia', texto: r });
    respostas.push({ role: 'sistema', texto: 'Alguém atendeu → perguntou pelo dono' });
    s.estagio = 'aguardando_dono';
    return respostas;
  }

  // ── BOT ──────────────────────────────────────────────
  if (intencao === 'BOT') {
    s.botDetectado = true;
    const r = 'Oii tudo bem? Eu falo com o dono(a)?';
    log(s, 'ia', r);
    respostas.push({ role: 'ia', texto: r });
    respostas.push({ role: 'sistema', texto: 'Bot detectado → perguntou pelo dono diretamente' });
    s.estagio = 'aguardando_dono';
    return respostas;
  }

  // ── OBJEÇÃO ──────────────────────────────────────────
  if (intencao === 'OBJECAO') {
    let r;
    if (pitchEnviado) {
      r = 'Entendo! Na verdade a diferença não é ter ou não ter cardápio — é sobre o cliente sentir desejo antes de escolher. Um cardápio comum mostra o que tem. O que eu faço faz o cliente querer o item mais caro antes de colocar a mão no bolso. Vale o dono(a) dar uma olhada na prévia, é rápido e sem compromisso 😊';
    } else {
      r = 'Entendo! Na verdade é bem diferente do cardápio comum — é sobre transformar a experiência do cliente na hora de escolher. Posso mostrar rapidinho pro(a) dono(a)? Leva 2 minutinhos e fica a critério dele(a).';
    }
    log(s, 'ia', r);
    respostas.push({ role: 'ia', texto: r });
    respostas.push({ role: 'sistema', texto: `Objeção detectada → rebateu e redirecionou ao dono` });
    s.estagio = s.decisorConfirmado ? 'abordagem_enviada' : 'aguardando_dono';
    return respostas;
  }

  // ── PERGUNTA DO ATENDENTE ────────────────────────────
  if (intencao === 'PERGUNTA_ATENDENTE') {
    const produto = s.lead.produto === 'agente_atendimento' ? 'agente de atendimento' : 'cardápio digital';
    const r = `É sobre um ${produto} pra vocês! Queria conversar rapidinho com o(a) dono(a) pra mostrar uma coisa bem bacana. Ele(a) se encontra?`;
    log(s, 'ia', r);
    respostas.push({ role: 'ia', texto: r });
    respostas.push({ role: 'sistema', texto: 'Atendente perguntou o assunto → explicou brevemente e redirecionou ao dono' });
    s.estagio = 'aguardando_dono';
    return respostas;
  }

  // ── GATEKEEPER ───────────────────────────────────────
  if (intencao === 'GATEKEEPER') {
    if (s.estagio === 'aguardando_dono') {
      // Já perguntamos pelo dono — agora pergunta horário
      const r = 'Entendido! O dono costuma estar por aí em algum horário específico?';
      log(s, 'ia', r);
      respostas.push({ role: 'ia', texto: r });
      respostas.push({ role: 'sistema', texto: 'Atendente confirmado → perguntou horário do dono' });
      s.estagio = 'perguntando_horario';
    } else {
      // Primeira identificação de gatekeeper
      const r = 'Oii tudo bem? Eu falo com o dono(a)?';
      log(s, 'ia', r);
      respostas.push({ role: 'ia', texto: r });
      respostas.push({ role: 'sistema', texto: 'Gatekeeper identificado → perguntou pelo dono' });
      s.estagio = 'aguardando_dono';
    }
    return respostas;
  }

  // ── RELAY — atendente vai repassar → envia pitch ao atendente ──
  if (intencao === 'RELAY') {
    s.decisorConfirmado = true;
    const mensagem = await gerarMensagemAbordagem(s.lead);
    const videoUrl = s.lead.produto === 'agente_atendimento'
      ? (process.env.VIDEO_MARMITARIA_URL || '[vídeo marmitaria — ainda não configurado]')
      : process.env.VIDEO_CARDAPIO_URL;

    if (videoUrl) {
      log(s, 'ia', '', { midia_url: videoUrl, midia_tipo: 'video' });
      respostas.push({ role: 'ia', texto: '', midia_url: videoUrl, midia_tipo: 'video' });
    }
    log(s, 'ia', mensagem);
    respostas.push({ role: 'ia', texto: mensagem });

    const followMsg = 'Amanhã vou entrar em contato de novo pra ver se ele(a) chegou a dar uma olhada 👍';
    log(s, 'ia', followMsg);
    respostas.push({ role: 'ia', texto: followMsg });
    respostas.push({ role: 'sistema', texto: 'Atendente vai repassar → enviou pitch + vídeo + aviso de follow-up amanhã' });
    s.estagio = 'abordagem_enviada';
    return respostas;
  }

  // ── HORARIO_DONO ─────────────────────────────────────
  if (intencao === 'HORARIO_DONO') {
    const r = 'Perfeito, obrigado! Vou entrar em contato no horário certo então 👍';
    log(s, 'ia', r);
    respostas.push({ role: 'ia', texto: r });
    respostas.push({ role: 'sistema', texto: 'Horário do dono registrado → follow-up agendado para esse horário' });
    s.estagio = 'aguardando_decisor_horario';
    return respostas;
  }

  // ── DECISOR confirmado → envia mensagem + vídeo ──────
  if (intencao === 'DECISOR' && !s.decisorConfirmado) {
    s.decisorConfirmado = true;
    const mensagem = await gerarMensagemAbordagem(s.lead);
    const videoUrl = s.lead.produto === 'agente_atendimento'
      ? (process.env.VIDEO_MARMITARIA_URL || '[vídeo marmitaria — ainda não configurado]')
      : process.env.VIDEO_CARDAPIO_URL;

    if (videoUrl) {
      log(s, 'ia', '', { midia_url: videoUrl, midia_tipo: 'video' });
      respostas.push({ role: 'ia', texto: '', midia_url: videoUrl, midia_tipo: 'video' });
    }
    log(s, 'ia', mensagem);
    respostas.push({ role: 'ia', texto: mensagem });
    s.estagio = 'abordagem_enviada';
    respostas.push({ role: 'sistema', texto: 'Decisor confirmado → mensagem personalizada + vídeo enviados' });
    return respostas;
  }

  // ── INTERESSE (só após pitch enviado) ─────────────────
  if ((intencao === 'INTERESSE' || intencao === 'PERGUNTA') && pitchEnviado) {
    s.estagio = 'interessado';
    respostas.push({
      role: 'sistema',
      texto: '🔥 INTERESSE detectado — agente pausaria aqui e te notificaria no WhatsApp pessoal',
      destaque: true,
    });
    return respostas;
  }

  // ── SEM INTERESSE ─────────────────────────────────────
  if (intencao === 'SEM_INTERESSE') {
    s.estagio = 'perdido';
    respostas.push({ role: 'sistema', texto: 'Recusa detectada → lead seria marcado como perdido' });
    return respostas;
  }

  // ── FOLLOW-UP (simular sem resposta) ─────────────────
  if (mensagemPeter === '__followup__') {
    s.tentativasFollowUp++;
    if (s.tentativasFollowUp > 4) {
      respostas.push({ role: 'sistema', texto: 'Máximo de follow-ups atingido → lead perdido' });
      return respostas;
    }
    const msg = await gerarFollowUp(s.lead, s.tentativasFollowUp);
    log(s, 'ia', msg);
    respostas.push({ role: 'ia', texto: msg });
    respostas.push({ role: 'sistema', texto: `Follow-up ${s.tentativasFollowUp}/4 enviado` });
    return respostas;
  }

  // ── NEUTRO ────────────────────────────────────────────
  log(s, 'sistema', `Intenção: ${intencao} — agente aguardaria sem responder`);
  respostas.push({ role: 'sistema', texto: `Intenção classificada como "${intencao}" → agente aguardaria sem responder` });
  return respostas;
}
