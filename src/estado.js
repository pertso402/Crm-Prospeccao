// Estado global do agente (em memória — reseta ao reiniciar)
// Para persistir, salvaríamos no Supabase, mas isso é suficiente pro uso diário

export const estado = {
  pausadoGlobal: false,      // para tudo
  motivoPausa: '',
};

export function pausarAgente(motivo = '') {
  estado.pausadoGlobal = true;
  estado.motivoPausa = motivo;
  console.log(`[estado] Agente PAUSADO. Motivo: ${motivo || 'manual'}`);
}

export function retomarAgente() {
  estado.pausadoGlobal = false;
  estado.motivoPausa = '';
  console.log('[estado] Agente RETOMADO.');
}

export function agenteAtivo() {
  if (estado.pausadoGlobal) return false;

  // Verifica janela de horário
  const agora = new Date();
  const [hIni, mIni] = (process.env.AGENTE_HORA_INICIO || '08:00').split(':').map(Number);
  const [hFim, mFim] = (process.env.AGENTE_HORA_FIM || '22:00').split(':').map(Number);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const minIni = hIni * 60 + mIni;
  const minFim = hFim * 60 + mFim;

  return minAgora >= minIni && minAgora <= minFim;
}
