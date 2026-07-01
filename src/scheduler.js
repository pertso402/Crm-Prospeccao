import cron from 'node-cron';
import { getLeadsProntos, getFollowUpsPendentes, marcarFollowUpExecutado, contarAbordagensHoje } from './db.js';
import { iniciarAbordagem, executarFollowUp } from './agente.js';
import { agenteAtivo } from './estado.js';

const INSTANCIAS = ['trimly', '7146'];
const LIMITE_POR_INSTANCIA = Number(process.env.LIMITE_DIARIO_INSTANCIA || 50);

// Leads já agendados nesta execução (evita o mesmo lead ser pego duas vezes
// enquanto espera o delay do setTimeout)
const emProcesso = new Set();
// Instâncias com envio agendado aguardando delay (1 envio por vez por instância)
const instanciaOcupada = new Set();

// Delays variados e não-previsíveis entre leads (anti-ban)
function gerarDelay() {
  const r = Math.random();
  if (r < 0.3) return (4 + Math.random() * 3) * 60 * 1000;   // 4–7 min (30% das vezes)
  if (r < 0.7) return (7 + Math.random() * 6) * 60 * 1000;   // 7–13 min (40% das vezes)
  return (13 + Math.random() * 10) * 60 * 1000;               // 13–23 min (30% das vezes)
}

// ── ABORDAGEM NOVA ────────────────────────────────────────
// Roda a cada 5 minutos. Cada instância opera de forma independente:
// 1 envio por vez, com delay aleatório, até o limite diário dela.

cron.schedule('*/5 * * * *', async () => {
  if (!agenteAtivo()) return;

  for (const inst of INSTANCIAS) {
    if (instanciaOcupada.has(inst)) continue; // já tem envio agendado

    let enviadosHoje;
    try {
      enviadosHoje = await contarAbordagensHoje(inst);
    } catch (e) {
      console.error(`[scheduler] contarAbordagensHoje (${inst}):`, e.message);
      continue;
    }
    if (enviadosHoje >= LIMITE_POR_INSTANCIA) continue;

    let leads;
    try {
      leads = await getLeadsProntos(inst);
    } catch (e) {
      console.error(`[scheduler] getLeadsProntos (${inst}):`, e.message);
      continue;
    }

    const lead = leads.find(l => !emProcesso.has(l.id));
    if (!lead) continue;

    emProcesso.add(lead.id);
    instanciaOcupada.add(inst);
    const delayMs = gerarDelay();

    console.log(`[scheduler] [${inst}] ${enviadosHoje}/${LIMITE_POR_INSTANCIA} hoje. Próxima em ${Math.round(delayMs / 60000)}min: ${lead.nome_negocio}`);

    setTimeout(async () => {
      try {
        // Revalida a janela de horário (o delay pode ter passado das 22h)
        if (agenteAtivo()) {
          await iniciarAbordagem(lead);
        } else {
          console.log(`[scheduler] [${inst}] Fora do horário, ${lead.nome_negocio} volta pra fila.`);
        }
      } catch (e) {
        console.error(`[scheduler] iniciarAbordagem (${lead.nome_negocio}):`, e.message);
      } finally {
        emProcesso.delete(lead.id);
        instanciaOcupada.delete(inst);
      }
    }, delayMs);
  }
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

console.log(`[scheduler] Ativo. Limite: ${LIMITE_POR_INSTANCIA}/dia por instância (${INSTANCIAS.join(', ')})`);
