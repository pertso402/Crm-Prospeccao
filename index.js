import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { processarResposta } from './src/agente.js';
import { ehEcoDoAgente } from './src/evolution.js';
import { logMensagem, updateLead, getLeadByWhatsapp, sessaoId } from './src/db.js';
import { pausarAgente, retomarAgente, estado, agenteAtivo } from './src/estado.js';
import { criarSessao, getSessao, simularInicio, simularResposta } from './src/simulador.js';
import { randomUUID } from 'crypto';
import './src/scheduler.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── WEBHOOK EVOLUTION API ─────────────────────────────────

// Dedup: a Evolution pode reentregar o mesmo evento
const msgsProcessadas = new Set();

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.event !== 'messages.upsert') return;

    const msg = body.data;
    if (!msg) return;

    const msgId = msg.key?.id;
    if (msgId) {
      if (msgsProcessadas.has(msgId)) return;
      msgsProcessadas.add(msgId);
      if (msgsProcessadas.size > 5000) {
        msgsProcessadas.delete(msgsProcessadas.values().next().value);
      }
    }

    const numero = msg.key?.remoteJid?.replace('@s.whatsapp.net', '');
    if (!numero) return;

    // Ignora grupos e broadcasts
    if (msg.key?.remoteJid?.includes('@g.us') || msg.key?.remoteJid?.includes('@broadcast')) return;

    const texto = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.buttonsResponseMessage?.selectedDisplayText
      || '';

    // ── MENSAGEM ENVIADA PELO PETER MANUALMENTE ───────────
    // fromMe = true significa que saiu do nosso número — pode ser Peter
    // digitando no celular OU o próprio agente enviando pela API (eco).
    if (msg.key?.fromMe) {
      if (!texto.trim()) return;

      // Eco do agente: mensagem que o próprio sistema enviou — já foi logada, ignora
      if (ehEcoDoAgente(numero, texto)) return;

      // Identifica qual lead é pelo número de destino
      const lead = await getLeadByWhatsapp(numero);
      if (!lead) return;

      // Pausa automática desse lead + loga a mensagem de Peter
      if (!lead.conversa_pausada) {
        await updateLead(lead.id, {
          conversa_pausada: true,
          assumido_por_humano: true,
          assumido_em: new Date().toISOString(),
          precisa_atencao: false,
        });
        await logMensagem({
          lead_id: lead.id,
          sessao_id: sessaoId(lead.id),
          remetente: 'sistema',
          mensagem: 'Peter entrou na conversa manualmente — agente pausado para este lead',
          stage_no_momento: lead.stage,
        });
        console.log(`[webhook] Peter assumiu manualmente: ${lead.nome_negocio}`);
      }

      // Loga a mensagem do Peter
      await logMensagem({
        lead_id: lead.id,
        sessao_id: sessaoId(lead.id),
        remetente: 'humano_peter',
        mensagem: texto,
        stage_no_momento: lead.stage,
      });
      return;
    }

    // ── MENSAGEM RECEBIDA DO LEAD ─────────────────────────
    if (!texto.trim()) return;
    console.log(`[webhook] ${numero}: "${texto.slice(0, 80)}"`);
    await processarResposta(numero, texto);

  } catch (err) {
    console.error('[webhook] Erro:', err.message);
  }
});

// ── PAINEL DE CONTROLE (admin) ────────────────────────────

function authAdmin(req, res, next) {
  const senha = req.headers['x-admin-senha'] || req.query.senha;
  if (senha !== process.env.ADMIN_SENHA) return res.status(401).json({ error: 'não autorizado' });
  next();
}

// Status atual
app.get('/admin/status', authAdmin, (_, res) => {
  res.json({
    ativo: agenteAtivo(),
    pausadoGlobal: estado.pausadoGlobal,
    motivoPausa: estado.motivoPausa,
    horario: `${process.env.AGENTE_HORA_INICIO} – ${process.env.AGENTE_HORA_FIM}`,
    agora: new Date().toLocaleTimeString('pt-BR'),
  });
});

// Pausar tudo
app.post('/admin/pausar', authAdmin, (req, res) => {
  pausarAgente(req.body.motivo || 'pausa manual');
  res.json({ ok: true, msg: 'Agente pausado' });
});

// Retomar
app.post('/admin/retomar', authAdmin, (_, res) => {
  retomarAgente();
  res.json({ ok: true, msg: 'Agente retomado' });
});

// Reativar agente para um lead específico (quando Peter terminar e quiser que IA retome)
app.post('/admin/reativar-lead/:lead_id', authAdmin, async (req, res) => {
  await updateLead(req.params.lead_id, {
    conversa_pausada: false,
    assumido_por_humano: false,
  });
  await logMensagem({
    lead_id: req.params.lead_id,
    sessao_id: sessaoId(req.params.lead_id),
    remetente: 'sistema',
    mensagem: 'Agente reativado para este lead por Peter',
    stage_no_momento: null,
  });
  res.json({ ok: true });
});

// Marcar lead como fechado
app.post('/admin/fechar-lead/:lead_id', authAdmin, async (req, res) => {
  await updateLead(req.params.lead_id, {
    stage: 'fechado',
    conversa_pausada: true,
    valor_contrato: req.body.valor || null,
  });
  res.json({ ok: true });
});

// Marcar lead como perdido
app.post('/admin/perder-lead/:lead_id', authAdmin, async (req, res) => {
  await updateLead(req.params.lead_id, {
    stage: 'perdido',
    conversa_pausada: true,
    motivo_perda: req.body.motivo || '',
  });
  res.json({ ok: true });
});

// ── SIMULADOR ─────────────────────────────────────────────

// Criar nova sessão de simulação
app.post('/sim/nova', (req, res) => {
  const { nome_negocio, produto, observacao_captacao, segmento, instancia_whatsapp } = req.body;
  if (!nome_negocio) return res.status(400).json({ error: 'nome_negocio obrigatório' });

  const id = randomUUID();
  criarSessao(id, { nome_negocio, produto: produto || 'cardapio', observacao_captacao, segmento, instancia_whatsapp: instancia_whatsapp || 'trimly' });
  res.json({ sessao_id: id });
});

// Iniciar a abordagem (IA manda o primeiro "Boa tarde")
app.post('/sim/iniciar/:id', async (req, res) => {
  try {
    const msgs = await simularInicio(req.params.id);
    const s = getSessao(req.params.id);
    res.json({ msgs, historico: s.historico, estagio: s.estagio });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Enviar mensagem como se fosse o lead respondendo
app.post('/sim/mensagem/:id', async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem) return res.status(400).json({ error: 'mensagem obrigatória' });
    const respostas = await simularResposta(req.params.id, mensagem);
    const s = getSessao(req.params.id);
    res.json({ respostas, historico: s.historico, estagio: s.estagio });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Simular follow-up sem resposta
app.post('/sim/followup/:id', async (req, res) => {
  try {
    const respostas = await simularResposta(req.params.id, '__followup__');
    const s = getSessao(req.params.id);
    res.json({ respostas, historico: s.historico, estagio: s.estagio });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── HEALTH ─────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Agente ARTe rodando na porta ${PORT}`);
  console.log(`   Webhook:  POST /webhook`);
  console.log(`   Admin:    GET  /admin/status?senha=${process.env.ADMIN_SENHA}`);
  console.log(`   Horário:  ${process.env.AGENTE_HORA_INICIO} – ${process.env.AGENTE_HORA_FIM}\n`);
});
