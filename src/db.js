import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── LEADS ──────────────────────────────────────────────────

export async function getLeadsProntos() {
  const agora = new Date();
  const hora = agora.getHours() * 60 + agora.getMinutes(); // minutos desde meia-noite

  const { data, error } = await db
    .from('leads')
    .select('*')
    .eq('stage', 'novo')
    .eq('conversa_pausada', false)
    .not('instancia_whatsapp', 'is', null)
    .not('whatsapp', 'is', null);

  if (error) throw error;

  // Filtra pelo horário de funcionamento do estabelecimento
  return (data || []).filter(l => {
    const ab = timeToMin(l.horario_abertura || '08:00:00');
    const fe = timeToMin(l.horario_fechamento || '22:00:00');
    return hora >= ab && hora <= fe - 30; // 30min de margem antes de fechar
  });
}

export async function getLead(id) {
  const { data, error } = await db.from('leads').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function getLeadByWhatsapp(numero) {
  const { data } = await db
    .from('leads')
    .select('*')
    .eq('whatsapp', numero)
    .neq('stage', 'perdido')
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

export async function updateLead(id, fields) {
  const { error } = await db
    .from('leads')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── CONVERSAS ──────────────────────────────────────────────

export async function logMensagem({ lead_id, sessao_id, remetente, mensagem, midia_url, midia_tipo, stage_no_momento }) {
  const { error } = await db.from('conversas').insert({
    lead_id, sessao_id, remetente, mensagem, midia_url, midia_tipo, stage_no_momento
  });
  if (error) console.error('[db] logMensagem error:', error.message);
}

export async function getConversa(lead_id) {
  const { data } = await db
    .from('conversas')
    .select('*')
    .eq('lead_id', lead_id)
    .order('created_at', { ascending: true });
  return data || [];
}

// ── FOLLOW-UPS ─────────────────────────────────────────────

export async function agendarFollowUp(lead_id, tipo, agendado_para) {
  const { error } = await db.from('follow_ups').insert({ lead_id, tipo, agendado_para });
  if (error) console.error('[db] agendarFollowUp error:', error.message);
}

export async function getFollowUpsPendentes() {
  const { data, error } = await db
    .from('follow_ups')
    .select('*, leads(*)')
    .eq('executado', false)
    .lte('agendado_para', new Date().toISOString());
  if (error) throw error;
  return data || [];
}

export async function marcarFollowUpExecutado(id) {
  await db.from('follow_ups').update({ executado: true, executado_em: new Date().toISOString() }).eq('id', id);
}

// ── HELPERS ────────────────────────────────────────────────

function timeToMin(timeStr) {
  const [h, m] = (timeStr || '08:00').split(':').map(Number);
  return h * 60 + m;
}

export function sessaoId(lead_id) {
  return `${lead_id}_${new Date().toISOString().slice(0, 10)}`;
}
