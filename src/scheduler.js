import cron from 'node-cron';
import { getLeadsProntos, getFollowUpsPendentes, marcarFollowUpExecutado } from './db.js';
import { iniciarAbordagem, executarFollowUp } from './agente.js';
import { agenteAtivo } from './estado.js';

// Controla quantos leads já foram abordados nessa sessão (anti-ban)
let abordadosHoje = 0;
let ultimaReset = new Date().toDateString();

const LIMITE_DIARIO = 50;

// Delays variados e não-previsíveis entre leads (anti-ban)
// Alterna entre janelas curtas e longas de forma aleatória
function gerarDelay() {
  const r = Math.random();
  if (r < 0.3) return (4 + Math.random() * 3) * 60 * 1000;   // 4–7 min (30% das vezes)
  if (r < 0.7) return (7 + Math.random() * 6) * 60 * 1000;   // 7–13 min (40% das vezes)
  return (13 + Math.random() * 10) * 60 * 1000;               // 13–23 min (30% das vezes)
}

// ── ABORDAGEM NOVA ────────────────────────────────────────
// Roda a cada 5 minutos e pega o próximo lead da fila

cron.schedule('*/5 * * * *', async () => {
  if (!agenteAtivo()) return;

  // Reset diário do contador
  const hoje = new Date().toDateString();
  if (ultimaReset !== hoje) { abordadosHoje = 0; ultimaReset = hoje; }

  if (abordadosHoje >= LIMITE_DIARIO) return;

  let leads;
  try { leads = await getLeadsProntos(); } catch (e) {
    console.error('[scheduler] getLeadsProntos error:', e.message); return;
  }

  if (!leads.length) return;

  // Pega apenas UM lead por tick — o delay está no cron interval + aleatoriedade
  const lead = leads[0];
  const delayMs = gerarDelay();

  console.log(`[scheduler] Próxima abordagem em ${Math.round(delayMs / 60000)}min: ${lead.nome_negocio}`);

  setTimeout(async () => {
    try {
      await iniciarAbordagem(lead);
      abordadosHoje++;
    } catch (e) {
      console.error('[scheduler] iniciarAbordagem error:', e.message);
    }
  }, delayMs);
});

// ── FOLLOW-UPS PENDENTES ──────────────────────────────────
// Roda a cada 3 minutos

cron.schedule('*/3 * * * *', async () => {
  if (!agenteAtivo()) return;
  let pendentes;
  try { pendentes = await getFollowUpsPendentes(); } catch (e) {
    console.error('[scheduler] getFollowUpsPendentes error:', e.message); return;
  }

  for (const fu of pendentes) {
    try {
      await marcarFollowUpExecutado(fu.id);
      await executarFollowUp(fu);
      // Delay entre follow-ups
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
    } catch (e) {
      console.error(`[scheduler] executarFollowUp error (${fu.id}):`, e.message);
    }
  }
});

console.log('[scheduler] Agendamentos ativos (08:00–22:00)');
