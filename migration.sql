-- ============================================================
-- MIGRATION: Sistema de Prospecção Automatizada
-- Cole e execute no SQL Editor do Supabase
-- ============================================================

-- 1. NOVOS TIPOS ENUM

-- Produto sendo vendido
DO $$ BEGIN
  CREATE TYPE public.produto_tipo AS ENUM ('cardapio', 'agente_atendimento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Estágios do pipeline de prospecção
DO $$ BEGIN
  ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'aguardando_decisor';
  ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'abordagem_enviada';
  ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'follow_up_frio';
  ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'interessado';
EXCEPTION WHEN others THEN NULL; END $$;

-- Remetente de mensagem (para log completo)
DO $$ BEGIN
  CREATE TYPE public.remetente_tipo AS ENUM ('ia', 'humano_peter', 'lead', 'sistema');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. ALTERAÇÕES NA TABELA leads
-- ============================================================

-- Produto (cardápio ou agente de atendimento)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS produto public.produto_tipo DEFAULT 'cardapio';

-- Instância WhatsApp que vai usar nesse lead
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS instancia_whatsapp TEXT; -- 'trimly' ou '7146'

-- Horário de funcionamento (para não mandar fora do horário)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS horario_abertura TIME DEFAULT '08:00:00';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS horario_fechamento TIME DEFAULT '22:00:00';

-- Observação do lead (o que Peter observou ao coletar)
-- (coluna observacao_captacao já existe — renomeando para clareza)
-- Mantemos observacao_captacao como está

-- Número de tentativas de follow-up feitas após abordagem
-- (tentativas_followup já existe)

-- Controle de detecção de bot
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS bot_detectado BOOLEAN DEFAULT FALSE;

-- Horário que o decisor estará disponível (quando atendente informa)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS decisor_disponivel_em TIMESTAMPTZ;

-- Flag: conversa pausada (Peter assumiu)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS conversa_pausada BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 3. ALTERAÇÕES NA TABELA interacoes
-- ============================================================

-- Quem mandou: ia, humano_peter, lead ou sistema
ALTER TABLE public.interacoes
  ADD COLUMN IF NOT EXISTS remetente public.remetente_tipo DEFAULT 'ia';

-- Mensagem recebida do lead (separada da enviada)
ALTER TABLE public.interacoes
  ADD COLUMN IF NOT EXISTS mensagem_recebida TEXT;

-- ID da sessão de conversa (agrupa toda a troca com aquele lead)
ALTER TABLE public.interacoes
  ADD COLUMN IF NOT EXISTS sessao_id TEXT;

-- Número de sequência na conversa (1, 2, 3...)
ALTER TABLE public.interacoes
  ADD COLUMN IF NOT EXISTS seq INTEGER DEFAULT 0;

-- ============================================================
-- 4. TABELA: conversas (log completo de cada sessão)
-- ============================================================
-- Cada linha = uma mensagem individual (entrada ou saída)
-- Permite reconstruir a conversa inteira de um lead

CREATE TABLE IF NOT EXISTS public.conversas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  sessao_id     TEXT NOT NULL,               -- agrupa mensagens de uma conversa
  remetente     public.remetente_tipo NOT NULL,
  mensagem      TEXT,                        -- texto da mensagem
  midia_url     TEXT,                        -- URL de vídeo/imagem enviado
  midia_tipo    TEXT,                        -- 'video', 'image', 'audio'
  stage_no_momento public.lead_stage,        -- stage do lead quando essa msg foi enviada
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversas_lead_id ON public.conversas(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversas_sessao_id ON public.conversas(sessao_id);
CREATE INDEX IF NOT EXISTS idx_conversas_created_at ON public.conversas(created_at DESC);

-- ============================================================
-- 5. TABELA: follow_ups (fila de follow-ups agendados)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,  -- 'frio_1','frio_2','frio_3','frio_4','decisor'
  agendado_para TIMESTAMPTZ NOT NULL,
  executado     BOOLEAN DEFAULT FALSE,
  executado_em  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followups_agendado ON public.follow_ups(agendado_para)
  WHERE executado = FALSE;

-- ============================================================
-- 6. RLS: permitir service role acessar tudo
-- ============================================================

ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access conversas"
    ON public.conversas FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service role full access follow_ups"
    ON public.follow_ups FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon read conversas"
    ON public.conversas FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "anon read follow_ups"
    ON public.follow_ups FOR SELECT TO anon USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 7. REALTIME: habilitar nas novas tabelas
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;

-- ============================================================
-- FIM DA MIGRATION
-- ============================================================
