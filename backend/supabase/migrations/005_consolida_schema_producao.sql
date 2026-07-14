-- ============================================================
-- Migration 005: consolida o schema real de produção em código.
--
-- Contexto: as migrations 001-004 cobrem só parte do banco. Várias
-- tabelas (incluindo usuarios_app) foram criadas direto no painel do
-- Supabase em algum momento, sem nunca virar migration -- ou seja, até
-- aqui não era possível reconstruir o banco 100% a partir do código-
-- fonte, e não havia garantia de que as tabelas "informais" tinham RLS
-- configurado corretamente.
--
-- Esta migration foi gerada a partir de um dump real do banco de
-- produção (pg_dump --schema-only), então descreve o estado atual
-- completo -- não um incremento. Por isso, tudo aqui usa formas
-- idempotentes (IF NOT EXISTS, DROP POLICY IF EXISTS antes de recriar,
-- blocos DO com tratamento de "já existe") -- rodar esta migration
-- contra o banco de produção atual não deve alterar nada (é o mesmo
-- estado, só documentado em código agora); rodar contra um banco novo/
-- vazio recria o schema inteiro do zero.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ────────────────────────────────────────────────────────────
-- Tabelas
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cache_overview (
    chave text NOT NULL,
    versao_base text NOT NULL,
    payload jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.config_producao_linhas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ano integer NOT NULL,
    linha text NOT NULL,
    periodo_tipo text NOT NULL,
    periodo_numero integer NOT NULL,
    cap_nominal_tb_h numeric(12,2) NOT NULL,
    oee_pct numeric(8,4) NOT NULL,
    cap_planejada_tb_h numeric(12,2) NOT NULL,
    horas_produtivas_dia numeric(8,2) NOT NULL,
    observacao text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT config_producao_linhas_periodo_tipo_check CHECK ((periodo_tipo = ANY (ARRAY['mes'::text, 'trimestre'::text, 'semestre'::text])))
);

CREATE TABLE IF NOT EXISTS public.d_bom_estrutura (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo_pai text NOT NULL,
    descricao_pai text,
    tipo_pai text,
    codigo_comp text NOT NULL,
    descricao_comp text,
    tp text,
    quantidade numeric,
    unidade text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_clientes (
    id bigint NOT NULL,
    codigo text NOT NULL,
    loja text,
    nome text,
    nome_fantasia text,
    pessoa text,
    tipo_cliente text,
    estado text,
    municipio text,
    regiao text,
    desc_regiao text,
    cnpj_cpf text,
    criado_em timestamp with time zone DEFAULT now(),
    pais_estimado text,
    confianca_pais text,
    base_inferencia_pais text
);

CREATE SEQUENCE IF NOT EXISTS public.d_clientes_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.d_clientes_id_seq OWNED BY public.d_clientes.id;

CREATE TABLE IF NOT EXISTS public.d_custo_unitario (
    codigo text NOT NULL,
    descricao text,
    tipo text,
    unidade text,
    custo_unitario numeric DEFAULT 0,
    ativo boolean DEFAULT true,
    observacao text,
    atualizado_em timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_depara_forecast_bom (
    cod_forecast text NOT NULL,
    desc_forecast text,
    cod_pai_bom text NOT NULL,
    desc_pai_bom text,
    fator_conversao numeric DEFAULT 1,
    ativo boolean DEFAULT true,
    observacao text,
    atualizado_em timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_grupos (
    grupo text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_lead_time_estoque (
    codigo text NOT NULL,
    descricao text,
    tipo text,
    unidade text,
    lead_time_dias numeric DEFAULT 0,
    ativo boolean DEFAULT true,
    observacao text,
    atualizado_em timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_lotes_teoricos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo_produto text NOT NULL,
    descricao_produto text,
    letra_lote text,
    linha text NOT NULL,
    qtd_teorica_abertura numeric NOT NULL,
    ativo boolean DEFAULT true,
    observacao text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_mrp_parametros (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chave text NOT NULL,
    valor text NOT NULL,
    descricao text,
    updated_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_mrp_parametros_produto (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo_produto text NOT NULL,
    grupo_produto text NOT NULL,
    qtd_tubetes_padrao numeric,
    un_hora_padrao numeric,
    lead_time_liberacao_dias integer,
    ativo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.d_produtos (
    cod_produto text NOT NULL,
    desc_produto text NOT NULL,
    grupo text NOT NULL,
    mercado text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    familia text,
    segmento text,
    abc_ytm text,
    linha text,
    status_portfolio text,
    concatenado_produto text,
    tipo_produto_erp text,
    status_original text,
    macro_negocio text,
    tipo_negocio text,
    transferencia_bravi text,
    fornecedor_terceiro text,
    modelo_fornecimento text,
    grupo_gerencial text,
    incluir_overview_anestesicos boolean DEFAULT false,
    ativo_analise boolean DEFAULT true,
    observacao text,
    CONSTRAINT d_produtos_mercado_check CHECK ((mercado = ANY (ARRAY['NACIONAL'::text, 'EXPORTAÇÃO'::text, 'PI'::text, 'NÃO INFORMADO'::text])))
);

CREATE TABLE IF NOT EXISTS public.d_qtd_minima_estoque (
    codigo text NOT NULL,
    descricao text,
    tipo text,
    unidade text,
    qtd_minima numeric DEFAULT 0,
    ativo boolean DEFAULT true,
    observacao text,
    atualizado_em timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.d_tipo_saida (
    cod_tipo text NOT NULL,
    tipo_tes text,
    txt_padrao text,
    descricao text
);

CREATE TABLE IF NOT EXISTS public.desvios_eventos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data_evento timestamp with time zone DEFAULT now(),
    snapshot_id uuid NOT NULL,
    tipo_evento text NOT NULL,
    serial text,
    lote text,
    campo text,
    valor_antigo text,
    valor_novo text,
    descricao text
);

CREATE TABLE IF NOT EXISTS public.desvios_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    data_upload timestamp with time zone DEFAULT now(),
    arquivo_origem text,
    serial text,
    titulo text,
    setor text,
    estado text,
    dias_desvio numeric,
    lote text,
    lote_original text,
    destino text
);

CREATE TABLE IF NOT EXISTS public.f_ajustes_compras_ops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    op_id text NOT NULL,
    lote text,
    codigo_op text,
    codigo_comp text NOT NULL,
    pedido_numero text,
    sc_numero text,
    qtd_negociada numeric DEFAULT 0,
    data_negociada date,
    observacao text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_apontamentos (
    id bigint NOT NULL,
    data_inicial timestamp with time zone NOT NULL,
    data_final timestamp with time zone,
    duracao_h numeric,
    tag text,
    equipamento text,
    etapa text,
    ordem text,
    lote text NOT NULL,
    produto text,
    sku text,
    qtd_produzida numeric DEFAULT 0,
    qtd_rejeitada numeric DEFAULT 0,
    tipo_evento text,
    evento text,
    situacao text,
    created_at timestamp with time zone DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.f_apontamentos'::regclass
          AND attname = 'id' AND attidentity <> ''
    ) THEN
        ALTER TABLE public.f_apontamentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
            SEQUENCE NAME public.f_apontamentos_id_seq
            START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.f_benzotop_liberacao (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id uuid,
    data_ref date DEFAULT CURRENT_DATE,
    arquivo_origem text,
    aba_origem text,
    codigo_pa text DEFAULT '52749'::text NOT NULL,
    descricao_pa text DEFAULT 'BENZOTOP - T.FRUTTI 30G'::text,
    dia_semana text,
    data_envase date,
    data_liberacao date,
    mes_envase integer,
    mes_liberacao integer,
    ano_envase integer,
    ano_liberacao integer,
    parada text,
    producao_dia numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_calendario_paradas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data date NOT NULL,
    linha text NOT NULL,
    descricao text NOT NULL,
    horas numeric,
    observacao text,
    origem text DEFAULT 'upload_excel'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_compras_abertas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sc_status text,
    sc_solicitante text,
    sc_numero text,
    sc_item text,
    sc_emissao date,
    sc_aprovador text,
    sc_aprovacao date,
    cotacao text,
    codigo_fornecedor text,
    razao_social_fornecedor text,
    pedido_emissao date,
    pedido_numero text,
    pedido_item text,
    produto_codigo text NOT NULL,
    produto_descricao text,
    produto_tipo text,
    produto_grupo text,
    produto_grupo_desc text,
    quantidade_sa numeric,
    quantidade_pc numeric,
    quantidade_entregue numeric,
    quantidade_pendente numeric,
    pedido_comprador text,
    pedido_data_aprovacao date,
    cc_codigo text,
    cc_descricao text,
    data_prevista_entrega date,
    data_recebimento date,
    mes_necessidade integer,
    ano_necessidade integer,
    data_previsao_necessidade date,
    id_comprador text,
    comprador text,
    atraso_entrega integer,
    situacao_data_exata text,
    entrega_status text,
    tempo_aprovacao_sc integer,
    atraso_entrega_range integer,
    situacao_range text,
    created_at timestamp with time zone DEFAULT now(),
    comprador_nome text,
    comprador_email text
);

CREATE TABLE IF NOT EXISTS public.f_compras_fup (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    arquivo_origem text,
    aba_origem text,
    linha_excel integer,
    produto_codigo text NOT NULL,
    produto_descricao text,
    produto_tipo text,
    produto_grupo text,
    sc_numero text,
    sc_item text,
    pedido_numero text,
    pedido_item text,
    quantidade_sa numeric,
    quantidade_pendente numeric,
    pedido_emissao date,
    sc_emissao date,
    data_prevista_entrega_original date,
    nova_previsao_fup date,
    comentario_fup text,
    status_fup text,
    fornecedor text,
    comprador text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.f_consumo_materiais (
    id bigint NOT NULL,
    data_snapshot timestamp with time zone DEFAULT now(),
    codigo text,
    produto text,
    unid text,
    armaz text,
    nome_2 text,
    tipo text,
    grupo text,
    grupo_descricao text,
    saldo numeric,
    m_05_2026 numeric, m_04_2026 numeric, m_03_2026 numeric, m_02_2026 numeric, m_01_2026 numeric,
    m_12_2025 numeric, m_11_2025 numeric, m_10_2025 numeric, m_09_2025 numeric, m_08_2025 numeric,
    m_07_2025 numeric, m_06_2025 numeric, m_05_2025 numeric, m_04_2025 numeric, m_03_2025 numeric,
    m_02_2025 numeric, m_01_2025 numeric,
    m_12_2024 numeric, m_11_2024 numeric, m_10_2024 numeric, m_09_2024 numeric, m_08_2024 numeric,
    m_07_2024 numeric, m_06_2024 numeric, m_05_2024 numeric,
    media_3m numeric, media_6m numeric, media_9m numeric, maior_media numeric,
    giro_estoque numeric, cobertura_dias numeric, maior_media_50 numeric, saldo_menos_maior_media_50 numeric,
    arquivo_origem text,
    created_at timestamp with time zone DEFAULT now(),
    m_06_2026 numeric DEFAULT 0, m_07_2026 numeric DEFAULT 0, m_08_2026 numeric DEFAULT 0,
    m_09_2026 numeric DEFAULT 0, m_10_2026 numeric DEFAULT 0, m_11_2026 numeric DEFAULT 0, m_12_2026 numeric DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS public.f_consumo_materiais_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.f_consumo_materiais_id_seq OWNED BY public.f_consumo_materiais.id;

CREATE TABLE IF NOT EXISTS public.f_desvios_lotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    serial text,
    titulo text,
    setor text,
    data_criacao date,
    estado text,
    dias_desvio numeric,
    lote text,
    lote_original text,
    destino text,
    arquivo_origem text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_entradas_planejado (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    versao text NOT NULL,
    mes integer NOT NULL,
    ano integer DEFAULT 2026 NOT NULL,
    linha text NOT NULL,
    qtd_planejado numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_entradas_previstas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    mes integer NOT NULL,
    ano integer NOT NULL,
    linha text NOT NULL,
    grupo text NOT NULL,
    qtd_caixas numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT f_entradas_previstas_linha_check CHECK ((linha = ANY (ARRAY['L1'::text, 'L2'::text]))),
    CONSTRAINT f_entradas_previstas_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);

CREATE TABLE IF NOT EXISTS public.f_estoque (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    mes integer NOT NULL,
    ano integer DEFAULT 2026 NOT NULL,
    produto text NOT NULL,
    armazem text NOT NULL,
    qtd_caixas numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT f_estoque_armazem_check CHECK ((armazem = ANY (ARRAY['04'::text, '07'::text]))),
    CONSTRAINT f_estoque_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);

CREATE TABLE IF NOT EXISTS public.f_estoque_saldo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data_ref date NOT NULL,
    codigo text NOT NULL,
    descricao text,
    armazem text NOT NULL,
    lote text,
    saldo_lote numeric DEFAULT 0,
    data_validade date,
    created_at timestamp with time zone DEFAULT now(),
    empenho_lote numeric DEFAULT 0,
    saldo_disponivel numeric DEFAULT 0,
    snapshot_id uuid,
    upload_id uuid,
    saldo_bruto numeric
);

CREATE TABLE IF NOT EXISTS public.f_faturados (
    id bigint NOT NULL,
    arquivo_origem text,
    linha_excel integer,
    criado_em timestamp with time zone DEFAULT now(),
    cliente text, razao_social text, estado text, regiao text, vendedor text,
    vendedor_resp text, nome_vendedor_resp text, empenho text, grupo text, produto text, descricao text,
    qtd_prepedido numeric(18,5), quantidade numeric(18,5), preco numeric(18,5), total numeric(18,2),
    valor_ipi numeric(18,2), valor_frete numeric(18,2), icms_retido numeric(18,2), despesa numeric(18,2),
    seguro numeric(18,2), valor_icms numeric(18,2), total_final numeric(18,2),
    documento text, emissao date, pedido text, emissao_ped date, lote text, prepedido text,
    emissao_preped date, saldo_preped numeric(18,5), origem text, operacao text,
    cofins numeric(18,2), pis numeric(18,2), dt_entrega date, moeda text, cotacao numeric(18,5),
    desc_cabecalho numeric(18,5), desc_item numeric(18,5), markup numeric(18,5), cond_pagto text,
    setor text, obs4 text, obs text, desc_preped text, filial text, obs_produto text,
    ano integer, mes integer, ano_mes text
);

CREATE SEQUENCE IF NOT EXISTS public.f_faturados_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.f_faturados_id_seq OWNED BY public.f_faturados.id;

CREATE TABLE IF NOT EXISTS public.f_forecast_sop (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    cod_produto text,
    desc_produto text,
    grupo text,
    familia text,
    mes integer NOT NULL,
    ano integer DEFAULT 2026 NOT NULL,
    qtd_forecast numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_liberacao_diaria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ano integer NOT NULL,
    mes integer NOT NULL,
    data_lib date NOT NULL,
    grupo_produto text NOT NULL,
    linha text,
    qtd_prevista numeric DEFAULT 0 NOT NULL,
    data_inicio date,
    data_fim date,
    versao_mps text,
    created_at timestamp with time zone DEFAULT now(),
    lote text
);

CREATE TABLE IF NOT EXISTS public.f_liberacao_exec_componentes_auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    ordem integer NOT NULL,
    componente text NOT NULL,
    tipo text NOT NULL,
    valor_cx numeric NOT NULL,
    valor_tubetes numeric,
    qtd_lotes integer,
    descricao text,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_liberacao_exec_horas_auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    data date NOT NULL,
    linha text NOT NULL,
    horas_v1 numeric,
    horas_atual numeric,
    var_horas numeric,
    comentario_v1 text,
    comentario_atual text,
    categoria_v1 text,
    categoria_atual text,
    causa_executiva text,
    impacto_cx numeric,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_liberacao_exec_lotes_auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    lote text,
    codigo text,
    produto text,
    linha text,
    versao text,
    qtd_tubetes numeric,
    qtd_cx numeric,
    mes_producao integer,
    ano_producao integer,
    data_inicio date,
    data_fim date,
    data_lib date,
    mes_liberacao integer,
    ano_liberacao integer,
    reprovado_qualidade boolean DEFAULT false,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_liberacao_exec_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ano_ref integer NOT NULL,
    mes_ref integer NOT NULL,
    versao_base text DEFAULT 'Jan/V3'::text,
    versao_atual text DEFAULT 'Jun/V4'::text,
    descricao text,
    ativo boolean DEFAULT true,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_liberacoes_previstas_sku (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ano integer NOT NULL,
    mes integer NOT NULL,
    linha text NOT NULL,
    cod_produto text NOT NULL,
    descricao text,
    tipo text,
    grupo text,
    mercado text,
    qtd_caixas numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    estoque_inicial numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.f_mps_liberacoes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    versao text NOT NULL,
    mes integer NOT NULL,
    ano integer DEFAULT 2026 NOT NULL,
    linha text NOT NULL,
    qtd_caixas numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    mes_revisao integer,
    CONSTRAINT f_mps_liberacoes_linha_check CHECK ((linha = ANY (ARRAY['L1'::text, 'L2'::text])))
);

CREATE TABLE IF NOT EXISTS public.f_mps_producao (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    versao text NOT NULL,
    data_dia date NOT NULL,
    linha text NOT NULL,
    horas_producao numeric DEFAULT 0 NOT NULL,
    horas_parada numeric DEFAULT 0 NOT NULL,
    comentario text,
    mes integer GENERATED ALWAYS AS ((EXTRACT(month FROM data_dia))::integer) STORED,
    ano integer GENERATED ALWAYS AS ((EXTRACT(year FROM data_dia))::integer) STORED,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT f_mps_producao_linha_check CHECK ((linha = ANY (ARRAY['L1'::text, 'L2'::text])))
);

CREATE TABLE IF NOT EXISTS public.f_mrp_alocacoes_dia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rodada_id uuid,
    etapa_id uuid,
    recurso text NOT NULL,
    lote text,
    codigo_produto text,
    descricao_produto text,
    data date NOT NULL,
    horas_alocadas numeric DEFAULT 0,
    horas_disponiveis_dia numeric,
    origem text DEFAULT 'IMPORT_MPS'::text,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_mrp_calendario_dia (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rodada_id uuid NOT NULL,
    recurso text NOT NULL,
    data date NOT NULL,
    horas_disponiveis_dia numeric,
    horas_indisponiveis_planejadas numeric,
    comentario_calendario text,
    origem_aba text,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_mrp_demanda (
    id bigint NOT NULL,
    data_rodada timestamp with time zone DEFAULT now(),
    arquivo_origem text,
    codigo text,
    descricao text,
    tipo text,
    un text,
    moq numeric,
    lead_time_total numeric,
    mes integer,
    ano integer,
    mes_label text,
    estoque_mrp numeric,
    demanda_mrp numeric,
    pedidos_mrp numeric,
    necessidade_mrp numeric,
    created_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.f_mrp_demanda_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.f_mrp_demanda_id_seq OWNED BY public.f_mrp_demanda.id;

CREATE TABLE IF NOT EXISTS public.f_mrp_etapas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rodada_id uuid,
    lote text,
    op text,
    codigo_produto text,
    descricao_produto text,
    etapa text NOT NULL,
    recurso text NOT NULL,
    linha_origem text,
    data_inicio date,
    data_fim date,
    data_pa date,
    qtd_planejada numeric DEFAULT 0,
    duracao_horas numeric DEFAULT 0,
    sequencia integer,
    status text DEFAULT 'planejada'::text,
    origem text,
    observacao text,
    criado_em timestamp without time zone DEFAULT now(),
    embalado text,
    un_hora numeric,
    mes_producao integer,
    ano_producao integer,
    mes_liberacao integer,
    ano_liberacao integer,
    mes_lib_manual boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.f_mrp_ordens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rodada_id uuid,
    op text,
    codigo_produto text,
    descricao_produto text,
    linha text,
    data_inicio date,
    data_fim date,
    data_negociada date,
    qtd_planejada numeric,
    qtd_atendida numeric DEFAULT 0,
    qtd_faltante numeric DEFAULT 0,
    status text DEFAULT 'planejada'::text,
    gargalo text,
    observacao text,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_mrp_producao_real (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rodada_id uuid,
    recurso text,
    lote text,
    op text,
    codigo_produto text,
    descricao_produto text,
    equipamento text,
    data_real_inicio date,
    data_real_fim date,
    hora_fim text,
    horas_reais numeric,
    qtd_real numeric,
    tipo_evento text,
    evento text,
    origem_arquivo text,
    created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_mrp_rodadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    mes integer NOT NULL,
    ano integer NOT NULL,
    versao integer NOT NULL,
    status text DEFAULT 'rascunho'::text,
    observacao text,
    criado_em timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_orcado_faturamento (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    cod_produto text,
    desc_produto text,
    grupo text,
    familia text,
    mes integer NOT NULL,
    ano integer DEFAULT 2026 NOT NULL,
    qtd_caixas numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_orcado_liberacao (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    mes integer NOT NULL,
    ano integer DEFAULT 2026 NOT NULL,
    linha text NOT NULL,
    qtd_tubetes numeric NOT NULL,
    qtd_caixas numeric GENERATED ALWAYS AS ((qtd_tubetes / (500)::numeric)) STORED,
    heranca_2025 boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT f_orcado_liberacao_linha_check CHECK ((linha = ANY (ARRAY['L1'::text, 'L2'::text]))),
    CONSTRAINT f_orcado_liberacao_mes_check CHECK (((mes >= 1) AND (mes <= 12)))
);

CREATE TABLE IF NOT EXISTS public.f_prepedidos_emitidos (
    id bigint NOT NULL,
    arquivo_origem text,
    linha_excel integer,
    criado_em timestamp with time zone DEFAULT now(),
    status text, prepedido text, emissao date, origem text, regiao text, cliente text, nome text,
    operacao text, tabela text, vendedor text, grupo text, produto text, descricao text,
    quant numeric(18,5), prcunit numeric(18,5), total numeric(18,2), saldo numeric(18,5),
    lote text, dt_validade date, pedorig text, emissao_ped date, entrega date, estoque numeric(18,5),
    moeda text, cotacao numeric(18,5), total_rs numeric(18,2), desc_cabecalho numeric(18,5),
    desc_item numeric(18,5), markup numeric(18,5), setor text, sit_estq text, sit_fin text,
    obs text, obs4 text, custo_medio numeric(18,5), margem_bruta numeric(18,5), filial text,
    obs_produto text, id_transferencia text, nf_transferencia text,
    ano integer, mes integer, ano_mes text, ano_entrega integer, mes_entrega integer, ano_mes_entrega text
);

CREATE SEQUENCE IF NOT EXISTS public.f_prepedidos_emitidos_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.f_prepedidos_emitidos_id_seq OWNED BY public.f_prepedidos_emitidos.id;

CREATE TABLE IF NOT EXISTS public.f_prepedidos_pendentes (
    id bigint NOT NULL,
    arquivo_origem text,
    linha_excel integer,
    criado_em timestamp with time zone DEFAULT now(),
    status text, prepedido text, emissao date, origem text, regiao text, cliente text, nome text,
    operacao text, tabela text, vendedor text, grupo text, produto text, descricao text,
    quant numeric(18,5), prcunit numeric(18,5), total numeric(18,2), saldo numeric(18,5),
    lote text, dt_validade date, pedorig text, emissao_ped date, entrega date, estoque numeric(18,5),
    moeda text, cotacao numeric(18,5), total_rs numeric(18,2), desc_cabecalho numeric(18,5),
    desc_item numeric(18,5), markup numeric(18,5), setor text, sit_estq text, sit_fin text,
    obs text, obs4 text, custo_medio numeric(18,5), margem_bruta numeric(18,5), filial text,
    obs_produto text, id_transferencia text, nf_transferencia text,
    ano integer, mes integer, ano_mes text, ano_entrega integer, mes_entrega integer, ano_mes_entrega text
);

CREATE SEQUENCE IF NOT EXISTS public.f_prepedidos_pendentes_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

ALTER SEQUENCE public.f_prepedidos_pendentes_id_seq OWNED BY public.f_prepedidos_pendentes.id;

CREATE TABLE IF NOT EXISTS public.f_producao_real (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    equipamento text,
    tipo_evento text,
    evento text,
    produto text,
    lote text,
    data_inicial timestamp with time zone,
    data_final timestamp with time zone,
    duracao_h numeric,
    qtd_produzida numeric DEFAULT 0,
    qtd_rejeitada numeric DEFAULT 0,
    mes integer,
    ano integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_programacao_ops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mes_ref text NOT NULL,
    linha text NOT NULL,
    lote text,
    codigo text NOT NULL,
    produto text,
    op_numero text,
    quantidade numeric,
    data_fim date,
    created_at timestamp with time zone DEFAULT now(),
    tempo_horas numeric,
    un_h numeric,
    observacoes text,
    data_lavagem_emb date,
    data_lavagem_pesagem date,
    data_inicio_fabricacao date,
    data_termino date
);

CREATE TABLE IF NOT EXISTS public.f_programacao_ops_resumo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mes_ref text NOT NULL,
    linha text NOT NULL,
    meta_mes_tubetes numeric,
    prog_mes_tubetes numeric,
    dif_mes_tubetes numeric,
    arquivo_origem text,
    atualizado_em timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_sd2_saidas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    produto text,
    descricao text,
    quantidade numeric NOT NULL,
    vlr_total numeric,
    armazem text,
    grupo text,
    cliente text,
    emissao date NOT NULL,
    mes integer GENERATED ALWAYS AS ((EXTRACT(month FROM emissao))::integer) STORED,
    ano integer GENERATED ALWAYS AS ((EXTRACT(year FROM emissao))::integer) STORED,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.f_sd3_entradas (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    produto text,
    descr_prod text,
    lote text,
    quantidade numeric NOT NULL,
    armazem text,
    grupo text,
    dt_emissao date NOT NULL,
    custo numeric,
    mes integer GENERATED ALWAYS AS ((EXTRACT(month FROM dt_emissao))::integer) STORED,
    ano integer GENERATED ALWAYS AS ((EXTRACT(year FROM dt_emissao))::integer) STORED,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.upload_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    base_id text NOT NULL,
    nome_arquivo text NOT NULL,
    storage_path text,
    status text NOT NULL,
    total_registros integer,
    erros jsonb,
    processado_em timestamp with time zone DEFAULT now(),
    CONSTRAINT upload_log_status_check CHECK ((status = ANY (ARRAY['processando'::text, 'sucesso'::text, 'erro'::text])))
);

-- usuarios_app: a tabela que motivou esta migration -- existia só no
-- painel do Supabase, sem nenhum registro em código até aqui.
CREATE TABLE IF NOT EXISTS public.usuarios_app (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id uuid,
    nome text NOT NULL,
    usuario text NOT NULL,
    email text NOT NULL,
    perfil text DEFAULT 'usuario'::text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    permissoes jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- View
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_liberacao_exec_snapshot_ativo AS
 SELECT s.id AS snapshot_id,
    s.ano_ref,
    s.mes_ref,
    s.versao_base,
    s.versao_atual,
    s.descricao AS snapshot_descricao,
    c.ordem,
    c.componente,
    c.tipo,
    c.valor_cx,
    c.valor_tubetes,
    c.qtd_lotes,
    c.descricao
   FROM (public.f_liberacao_exec_snapshot s
     JOIN public.f_liberacao_exec_componentes_auditoria c ON ((c.snapshot_id = s.id)))
  WHERE (s.ativo = true)
  ORDER BY c.ordem;

-- ────────────────────────────────────────────────────────────
-- Defaults de sequência (para as tabelas com bigint id + sequence)
-- ────────────────────────────────────────────────────────────

ALTER TABLE ONLY public.d_clientes ALTER COLUMN id SET DEFAULT nextval('public.d_clientes_id_seq'::regclass);
ALTER TABLE ONLY public.f_consumo_materiais ALTER COLUMN id SET DEFAULT nextval('public.f_consumo_materiais_id_seq'::regclass);
ALTER TABLE ONLY public.f_faturados ALTER COLUMN id SET DEFAULT nextval('public.f_faturados_id_seq'::regclass);
ALTER TABLE ONLY public.f_mrp_demanda ALTER COLUMN id SET DEFAULT nextval('public.f_mrp_demanda_id_seq'::regclass);
ALTER TABLE ONLY public.f_prepedidos_emitidos ALTER COLUMN id SET DEFAULT nextval('public.f_prepedidos_emitidos_id_seq'::regclass);
ALTER TABLE ONLY public.f_prepedidos_pendentes ALTER COLUMN id SET DEFAULT nextval('public.f_prepedidos_pendentes_id_seq'::regclass);

-- ────────────────────────────────────────────────────────────
-- Constraints (PK, UNIQUE) -- em blocos DO, ignora se já existir
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
    ALTER TABLE ONLY public.cache_overview ADD CONSTRAINT cache_overview_pkey PRIMARY KEY (chave);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.config_producao_linhas ADD CONSTRAINT config_producao_linhas_ano_linha_periodo_tipo_periodo_numer_key UNIQUE (ano, linha, periodo_tipo, periodo_numero);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.config_producao_linhas ADD CONSTRAINT config_producao_linhas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_bom_estrutura ADD CONSTRAINT d_bom_estrutura_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_clientes ADD CONSTRAINT d_clientes_codigo_loja_key UNIQUE (codigo, loja);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_clientes ADD CONSTRAINT d_clientes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_custo_unitario ADD CONSTRAINT d_custo_unitario_pkey PRIMARY KEY (codigo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_depara_forecast_bom ADD CONSTRAINT d_depara_forecast_bom_pkey PRIMARY KEY (cod_forecast);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_grupos ADD CONSTRAINT d_grupos_pkey PRIMARY KEY (grupo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_lead_time_estoque ADD CONSTRAINT d_lead_time_estoque_pkey PRIMARY KEY (codigo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_lotes_teoricos ADD CONSTRAINT d_lotes_teoricos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_mrp_parametros ADD CONSTRAINT d_mrp_parametros_chave_key UNIQUE (chave);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_mrp_parametros ADD CONSTRAINT d_mrp_parametros_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_mrp_parametros_produto ADD CONSTRAINT d_mrp_parametros_produto_codigo_produto_key UNIQUE (codigo_produto);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_mrp_parametros_produto ADD CONSTRAINT d_mrp_parametros_produto_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_produtos ADD CONSTRAINT d_produtos_pkey PRIMARY KEY (cod_produto);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_qtd_minima_estoque ADD CONSTRAINT d_qtd_minima_estoque_pkey PRIMARY KEY (codigo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.d_tipo_saida ADD CONSTRAINT d_tipo_saida_pkey PRIMARY KEY (cod_tipo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.desvios_eventos ADD CONSTRAINT desvios_eventos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.desvios_snapshots ADD CONSTRAINT desvios_snapshots_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_ajustes_compras_ops ADD CONSTRAINT f_ajustes_compras_ops_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_apontamentos ADD CONSTRAINT f_apontamentos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_benzotop_liberacao ADD CONSTRAINT f_benzotop_liberacao_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_calendario_paradas ADD CONSTRAINT f_calendario_paradas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_compras_abertas ADD CONSTRAINT f_compras_abertas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_compras_fup ADD CONSTRAINT f_compras_fup_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_consumo_materiais ADD CONSTRAINT f_consumo_materiais_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_desvios_lotes ADD CONSTRAINT f_desvios_lotes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_entradas_planejado ADD CONSTRAINT f_entradas_planejado_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_entradas_previstas ADD CONSTRAINT f_entradas_previstas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_estoque ADD CONSTRAINT f_estoque_mes_ano_produto_armazem_key UNIQUE (mes, ano, produto, armazem);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_estoque ADD CONSTRAINT f_estoque_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_estoque_saldo ADD CONSTRAINT f_estoque_saldo_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_faturados ADD CONSTRAINT f_faturados_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_forecast_sop ADD CONSTRAINT f_forecast_sop_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_diaria ADD CONSTRAINT f_liberacao_diaria_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_componentes_auditoria ADD CONSTRAINT f_liberacao_exec_componentes_auditoria_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_horas_auditoria ADD CONSTRAINT f_liberacao_exec_horas_auditoria_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_lotes_auditoria ADD CONSTRAINT f_liberacao_exec_lotes_auditoria_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_snapshot ADD CONSTRAINT f_liberacao_exec_snapshot_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacoes_previstas_sku ADD CONSTRAINT f_liberacoes_previstas_sku_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mps_liberacoes ADD CONSTRAINT f_mps_liberacoes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mps_producao ADD CONSTRAINT f_mps_producao_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mps_producao ADD CONSTRAINT f_mps_producao_versao_data_dia_linha_key UNIQUE (versao, data_dia, linha);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_alocacoes_dia ADD CONSTRAINT f_mrp_alocacoes_dia_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_calendario_dia ADD CONSTRAINT f_mrp_calendario_dia_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_calendario_dia ADD CONSTRAINT f_mrp_calendario_dia_unq UNIQUE (rodada_id, recurso, data);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_demanda ADD CONSTRAINT f_mrp_demanda_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_etapas ADD CONSTRAINT f_mrp_etapas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_ordens ADD CONSTRAINT f_mrp_ordens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_producao_real ADD CONSTRAINT f_mrp_producao_real_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_rodadas ADD CONSTRAINT f_mrp_rodadas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_orcado_faturamento ADD CONSTRAINT f_orcado_faturamento_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_orcado_liberacao ADD CONSTRAINT f_orcado_liberacao_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_prepedidos_emitidos ADD CONSTRAINT f_prepedidos_emitidos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_prepedidos_pendentes ADD CONSTRAINT f_prepedidos_pendentes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_producao_real ADD CONSTRAINT f_producao_real_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_programacao_ops ADD CONSTRAINT f_programacao_ops_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_programacao_ops_resumo ADD CONSTRAINT f_programacao_ops_resumo_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_sd2_saidas ADD CONSTRAINT f_sd2_saidas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_sd3_entradas ADD CONSTRAINT f_sd3_entradas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.upload_log ADD CONSTRAINT upload_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.usuarios_app ADD CONSTRAINT usuarios_app_auth_user_id_key UNIQUE (auth_user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.usuarios_app ADD CONSTRAINT usuarios_app_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.usuarios_app ADD CONSTRAINT usuarios_app_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.usuarios_app ADD CONSTRAINT usuarios_app_usuario_key UNIQUE (usuario);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────
-- Foreign keys
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
    ALTER TABLE ONLY public.f_forecast_sop ADD CONSTRAINT f_forecast_sop_cod_produto_fkey FOREIGN KEY (cod_produto) REFERENCES public.d_produtos(cod_produto);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_componentes_auditoria ADD CONSTRAINT f_liberacao_exec_componentes_auditoria_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.f_liberacao_exec_snapshot(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_horas_auditoria ADD CONSTRAINT f_liberacao_exec_horas_auditoria_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.f_liberacao_exec_snapshot(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_liberacao_exec_lotes_auditoria ADD CONSTRAINT f_liberacao_exec_lotes_auditoria_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.f_liberacao_exec_snapshot(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_alocacoes_dia ADD CONSTRAINT f_mrp_alocacoes_dia_etapa_id_fkey FOREIGN KEY (etapa_id) REFERENCES public.f_mrp_etapas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_alocacoes_dia ADD CONSTRAINT f_mrp_alocacoes_dia_rodada_id_fkey FOREIGN KEY (rodada_id) REFERENCES public.f_mrp_rodadas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_calendario_dia ADD CONSTRAINT f_mrp_calendario_dia_rodada_id_fkey FOREIGN KEY (rodada_id) REFERENCES public.f_mrp_rodadas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_etapas ADD CONSTRAINT f_mrp_etapas_rodada_id_fkey FOREIGN KEY (rodada_id) REFERENCES public.f_mrp_rodadas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
    ALTER TABLE ONLY public.f_mrp_ordens ADD CONSTRAINT f_mrp_ordens_rodada_id_fkey FOREIGN KEY (rodada_id) REFERENCES public.f_mrp_rodadas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────
-- Índices
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS f_apontamentos_data_inicial_idx ON public.f_apontamentos USING btree (data_inicial);
CREATE INDEX IF NOT EXISTS f_apontamentos_etapa_idx ON public.f_apontamentos USING btree (etapa);
CREATE INDEX IF NOT EXISTS f_apontamentos_lote_idx ON public.f_apontamentos USING btree (lote);
CREATE INDEX IF NOT EXISTS f_liberacoes_previstas_sku_ano_mes_grupo_idx ON public.f_liberacoes_previstas_sku USING btree (ano, mes, grupo);
CREATE INDEX IF NOT EXISTS f_liberacoes_previstas_sku_ano_mes_linha_idx ON public.f_liberacoes_previstas_sku USING btree (ano, mes, linha);
CREATE INDEX IF NOT EXISTS idx_ajustes_compras_ops_comp ON public.f_ajustes_compras_ops USING btree (codigo_comp);
CREATE INDEX IF NOT EXISTS idx_ajustes_compras_ops_op ON public.f_ajustes_compras_ops USING btree (op_id);
CREATE INDEX IF NOT EXISTS idx_bom_codigo_pai ON public.d_bom_estrutura USING btree (codigo_pai);
CREATE INDEX IF NOT EXISTS idx_cache_overview_atualizado ON public.cache_overview USING btree (atualizado_em DESC);
CREATE INDEX IF NOT EXISTS idx_d_clientes_codigo ON public.d_clientes USING btree (codigo);
CREATE INDEX IF NOT EXISTS idx_d_clientes_estado ON public.d_clientes USING btree (estado);
CREATE INDEX IF NOT EXISTS idx_d_clientes_pais_estimado ON public.d_clientes USING btree (pais_estimado);
CREATE INDEX IF NOT EXISTS idx_d_clientes_tipo ON public.d_clientes USING btree (tipo_cliente);
CREATE INDEX IF NOT EXISTS idx_d_produtos_cod_produto ON public.d_produtos USING btree (cod_produto);
CREATE INDEX IF NOT EXISTS idx_entradas_prev_mes ON public.f_entradas_previstas USING btree (mes, ano);
CREATE INDEX IF NOT EXISTS idx_estoque_data_codigo ON public.f_estoque_saldo USING btree (data_ref, codigo, armazem);
CREATE INDEX IF NOT EXISTS idx_estoque_mes ON public.f_estoque USING btree (mes, ano);
CREATE INDEX IF NOT EXISTS idx_f_apontamentos_data_equipamento ON public.f_apontamentos USING btree (data_inicial, equipamento);
CREATE INDEX IF NOT EXISTS idx_f_apontamentos_data_inicial ON public.f_apontamentos USING btree (data_inicial);
CREATE INDEX IF NOT EXISTS idx_f_apontamentos_evento ON public.f_apontamentos USING btree (evento);
CREATE INDEX IF NOT EXISTS idx_f_apontamentos_lote ON public.f_apontamentos USING btree (lote);
CREATE INDEX IF NOT EXISTS idx_f_apontamentos_ordem ON public.f_apontamentos USING btree (ordem);
CREATE INDEX IF NOT EXISTS idx_f_apontamentos_tipo_evento ON public.f_apontamentos USING btree (tipo_evento);
CREATE INDEX IF NOT EXISTS idx_f_benzotop_liberacao_codigo ON public.f_benzotop_liberacao USING btree (codigo_pa);
CREATE INDEX IF NOT EXISTS idx_f_benzotop_liberacao_mes ON public.f_benzotop_liberacao USING btree (ano_liberacao, mes_liberacao);
CREATE INDEX IF NOT EXISTS idx_f_benzotop_liberacao_upload ON public.f_benzotop_liberacao USING btree (upload_id);
CREATE INDEX IF NOT EXISTS idx_f_calendario_paradas_data ON public.f_calendario_paradas USING btree (data);
CREATE INDEX IF NOT EXISTS idx_f_calendario_paradas_linha ON public.f_calendario_paradas USING btree (linha);
CREATE INDEX IF NOT EXISTS idx_f_compras_abertas_data_prevista ON public.f_compras_abertas USING btree (data_prevista_entrega);
CREATE INDEX IF NOT EXISTS idx_f_compras_abertas_pedido ON public.f_compras_abertas USING btree (pedido_numero);
CREATE INDEX IF NOT EXISTS idx_f_compras_abertas_produto ON public.f_compras_abertas USING btree (produto_codigo);
CREATE INDEX IF NOT EXISTS idx_f_compras_abertas_produto_codigo ON public.f_compras_abertas USING btree (produto_codigo);
CREATE INDEX IF NOT EXISTS idx_f_compras_abertas_sc ON public.f_compras_abertas USING btree (sc_numero);
CREATE INDEX IF NOT EXISTS idx_f_compras_abertas_status ON public.f_compras_abertas USING btree (entrega_status);
CREATE INDEX IF NOT EXISTS idx_f_compras_fup_created_at ON public.f_compras_fup USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_f_compras_fup_pedido ON public.f_compras_fup USING btree (produto_codigo, pedido_numero, pedido_item);
CREATE INDEX IF NOT EXISTS idx_f_compras_fup_produto ON public.f_compras_fup USING btree (produto_codigo);
CREATE INDEX IF NOT EXISTS idx_f_compras_fup_sc ON public.f_compras_fup USING btree (produto_codigo, sc_numero, sc_item);
CREATE INDEX IF NOT EXISTS idx_f_consumo_materiais_data_snapshot ON public.f_consumo_materiais USING btree (data_snapshot DESC);
CREATE INDEX IF NOT EXISTS idx_f_entradas_planejado_ano_e518d8 ON public.f_entradas_planejado USING btree (ano);
CREATE INDEX IF NOT EXISTS idx_f_entradas_planejado_created_at_62eca7 ON public.f_entradas_planejado USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_f_entradas_planejado_mes_5bf63d ON public.f_entradas_planejado USING btree (mes);
CREATE INDEX IF NOT EXISTS idx_f_entradas_planejado_versao_d58d75 ON public.f_entradas_planejado USING btree (versao);
CREATE INDEX IF NOT EXISTS idx_f_estoque_saldo_codigo ON public.f_estoque_saldo USING btree (codigo);
CREATE INDEX IF NOT EXISTS idx_f_estoque_saldo_codigo_data_ref ON public.f_estoque_saldo USING btree (codigo, data_ref DESC);
CREATE INDEX IF NOT EXISTS idx_f_estoque_saldo_snapshot_codigo ON public.f_estoque_saldo USING btree (snapshot_id, codigo);
CREATE INDEX IF NOT EXISTS idx_f_estoque_saldo_snapshot_created ON public.f_estoque_saldo USING btree (created_at DESC, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_f_faturados_ano_mes ON public.f_faturados USING btree (ano, mes);
CREATE INDEX IF NOT EXISTS idx_f_faturados_cliente ON public.f_faturados USING btree (cliente);
CREATE INDEX IF NOT EXISTS idx_f_faturados_documento ON public.f_faturados USING btree (documento);
CREATE INDEX IF NOT EXISTS idx_f_faturados_emissao ON public.f_faturados USING btree (emissao);
CREATE INDEX IF NOT EXISTS idx_f_faturados_estado ON public.f_faturados USING btree (estado);
CREATE INDEX IF NOT EXISTS idx_f_faturados_pedido ON public.f_faturados USING btree (pedido);
CREATE INDEX IF NOT EXISTS idx_f_faturados_prepedido ON public.f_faturados USING btree (prepedido);
CREATE INDEX IF NOT EXISTS idx_f_faturados_produto ON public.f_faturados USING btree (produto);
CREATE INDEX IF NOT EXISTS idx_f_faturados_regiao ON public.f_faturados USING btree (regiao);
CREATE INDEX IF NOT EXISTS idx_f_forecast_sop_cod_ano_mes ON public.f_forecast_sop USING btree (cod_produto, ano, mes);
CREATE INDEX IF NOT EXISTS idx_f_liberacao_diaria_ano_4d6cfc ON public.f_liberacao_diaria USING btree (ano);
CREATE INDEX IF NOT EXISTS idx_f_liberacao_diaria_created_at_5c2adb ON public.f_liberacao_diaria USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_f_liberacao_diaria_mes_801207 ON public.f_liberacao_diaria USING btree (mes);
CREATE INDEX IF NOT EXISTS idx_f_mps_liberacoes_ano_mes ON public.f_mps_liberacoes USING btree (ano, mes);
CREATE INDEX IF NOT EXISTS idx_f_mrp_alocacoes_dia_rodada_id ON public.f_mrp_alocacoes_dia USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_alocacoes_dia_rodada_id_3c4428 ON public.f_mrp_alocacoes_dia USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_calendario_dia_recurso_data ON public.f_mrp_calendario_dia USING btree (recurso, data);
CREATE INDEX IF NOT EXISTS idx_f_mrp_calendario_dia_rodada ON public.f_mrp_calendario_dia USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_calendario_dia_rodada_id ON public.f_mrp_calendario_dia USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_demanda_codigo ON public.f_mrp_demanda USING btree (codigo);
CREATE INDEX IF NOT EXISTS idx_f_mrp_demanda_codigo_mes_ano ON public.f_mrp_demanda USING btree (codigo, mes, ano);
CREATE INDEX IF NOT EXISTS idx_f_mrp_demanda_data_rodada ON public.f_mrp_demanda USING btree (data_rodada);
CREATE INDEX IF NOT EXISTS idx_f_mrp_etapas_rodada_id ON public.f_mrp_etapas USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_etapas_rodada_id_b2b214 ON public.f_mrp_etapas USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_producao_real_created_at_5bad31 ON public.f_mrp_producao_real USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_f_mrp_producao_real_rodada_id ON public.f_mrp_producao_real USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_mrp_producao_real_rodada_id_8b0d8e ON public.f_mrp_producao_real USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_ano_mes ON public.f_prepedidos_emitidos USING btree (ano, mes);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_cliente ON public.f_prepedidos_emitidos USING btree (cliente);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_emissao ON public.f_prepedidos_emitidos USING btree (emissao);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_entrega ON public.f_prepedidos_emitidos USING btree (entrega);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_prepedido ON public.f_prepedidos_emitidos USING btree (prepedido);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_produto ON public.f_prepedidos_emitidos USING btree (produto);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_emitidos_status ON public.f_prepedidos_emitidos USING btree (status);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_ano_mes ON public.f_prepedidos_pendentes USING btree (ano, mes);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_cliente ON public.f_prepedidos_pendentes USING btree (cliente);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_emissao ON public.f_prepedidos_pendentes USING btree (emissao);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_entrega ON public.f_prepedidos_pendentes USING btree (entrega);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_prepedido ON public.f_prepedidos_pendentes USING btree (prepedido);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_produto ON public.f_prepedidos_pendentes USING btree (produto);
CREATE INDEX IF NOT EXISTS idx_f_prepedidos_pendentes_status ON public.f_prepedidos_pendentes USING btree (status);
CREATE INDEX IF NOT EXISTS idx_f_programacao_ops_linha ON public.f_programacao_ops USING btree (linha);
CREATE INDEX IF NOT EXISTS idx_f_programacao_ops_lote ON public.f_programacao_ops USING btree (lote);
CREATE INDEX IF NOT EXISTS idx_f_programacao_ops_mes_ref ON public.f_programacao_ops USING btree (mes_ref);
CREATE INDEX IF NOT EXISTS idx_f_programacao_ops_resumo_mes_linha ON public.f_programacao_ops_resumo USING btree (mes_ref, linha);
CREATE INDEX IF NOT EXISTS idx_f_sd2_saidas_produto_emissao ON public.f_sd2_saidas USING btree (produto, emissao);
CREATE INDEX IF NOT EXISTS idx_fk_f_forecast_sop_f_forecast_sop_cod_produto_f_cb7a02aa ON public.f_forecast_sop USING btree (cod_produto);
CREATE INDEX IF NOT EXISTS idx_fk_f_liberacao_exec_componentes_auditoria_f_li_e53af2a2 ON public.f_liberacao_exec_componentes_auditoria USING btree (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_liberacao_exec_horas_auditoria_f_liberaca_9d326bd8 ON public.f_liberacao_exec_horas_auditoria USING btree (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_liberacao_exec_lotes_auditoria_f_liberaca_4ae55d70 ON public.f_liberacao_exec_lotes_auditoria USING btree (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_mrp_alocacoes_dia_f_mrp_alocacoes_dia_eta_762f49a0 ON public.f_mrp_alocacoes_dia USING btree (etapa_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_mrp_alocacoes_dia_f_mrp_alocacoes_dia_rod_7ab4dacc ON public.f_mrp_alocacoes_dia USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_mrp_calendario_dia_f_mrp_calendario_dia_r_41c088a3 ON public.f_mrp_calendario_dia USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_mrp_etapas_f_mrp_etapas_rodada_id_fkey_01de8a2f ON public.f_mrp_etapas USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_fk_f_mrp_ordens_f_mrp_ordens_rodada_id_fkey_5eba67fb ON public.f_mrp_ordens USING btree (rodada_id);
CREATE INDEX IF NOT EXISTS idx_forecast_mes ON public.f_forecast_sop USING btree (mes, ano);
CREATE INDEX IF NOT EXISTS idx_mps_prod_data ON public.f_mps_producao USING btree (data_dia, linha);
CREATE INDEX IF NOT EXISTS idx_ops_mes ON public.f_programacao_ops USING btree (mes_ref);
CREATE INDEX IF NOT EXISTS idx_orcado_fat_mes ON public.f_orcado_faturamento USING btree (mes, ano);
CREATE INDEX IF NOT EXISTS idx_producao_data ON public.f_producao_real USING btree (data_inicial);
CREATE INDEX IF NOT EXISTS idx_sd2_emissao ON public.f_sd2_saidas USING btree (emissao);
CREATE INDEX IF NOT EXISTS idx_sd2_grupo ON public.f_sd2_saidas USING btree (grupo);
CREATE INDEX IF NOT EXISTS idx_sd3_dt_emissao ON public.f_sd3_entradas USING btree (dt_emissao);
CREATE INDEX IF NOT EXISTS idx_sd3_grupo ON public.f_sd3_entradas USING btree (grupo);
CREATE INDEX IF NOT EXISTS idx_upload_log_base_id ON public.upload_log USING btree (base_id);
CREATE INDEX IF NOT EXISTS idx_upload_log_base_status_processado ON public.upload_log USING btree (base_id, status, processado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_d_lotes_teoricos_codigo_linha ON public.d_lotes_teoricos USING btree (codigo_produto, linha);

-- ────────────────────────────────────────────────────────────
-- Row Level Security -- habilitar em todas (idempotente por natureza)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.cache_overview ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_producao_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_bom_estrutura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_custo_unitario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_depara_forecast_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_lead_time_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_lotes_teoricos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_mrp_parametros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_mrp_parametros_produto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_qtd_minima_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.d_tipo_saida ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desvios_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desvios_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_ajustes_compras_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_apontamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_benzotop_liberacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_calendario_paradas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_compras_abertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_compras_fup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_consumo_materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_desvios_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_entradas_planejado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_entradas_previstas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_estoque_saldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_faturados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_forecast_sop ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_liberacao_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_liberacao_exec_componentes_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_liberacao_exec_horas_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_liberacao_exec_lotes_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_liberacao_exec_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_liberacoes_previstas_sku ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mps_liberacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mps_producao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_alocacoes_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_calendario_dia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_demanda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_etapas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_ordens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_producao_real ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_mrp_rodadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_orcado_faturamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_orcado_liberacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_prepedidos_emitidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_prepedidos_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_producao_real ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_programacao_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_programacao_ops_resumo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_sd2_saidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.f_sd3_entradas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_app ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- Políticas de RLS -- DROP IF EXISTS + CREATE, para serem idempotentes
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can read bom" ON public.d_bom_estrutura;
CREATE POLICY "Authenticated users can read bom" ON public.d_bom_estrutura FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read estoque" ON public.f_estoque_saldo;
CREATE POLICY "Authenticated users can read estoque" ON public.f_estoque_saldo FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can read ops" ON public.f_programacao_ops;
CREATE POLICY "Authenticated users can read ops" ON public.f_programacao_ops FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.d_produtos;
CREATE POLICY "Public read all" ON public.d_produtos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_estoque;
CREATE POLICY "Public read all" ON public.f_estoque FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_forecast_sop;
CREATE POLICY "Public read all" ON public.f_forecast_sop FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_mps_liberacoes;
CREATE POLICY "Public read all" ON public.f_mps_liberacoes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_mps_producao;
CREATE POLICY "Public read all" ON public.f_mps_producao FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_orcado_liberacao;
CREATE POLICY "Public read all" ON public.f_orcado_liberacao FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_producao_real;
CREATE POLICY "Public read all" ON public.f_producao_real FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_sd2_saidas;
CREATE POLICY "Public read all" ON public.f_sd2_saidas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.f_sd3_entradas;
CREATE POLICY "Public read all" ON public.f_sd3_entradas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read all" ON public.upload_log;
CREATE POLICY "Public read all" ON public.upload_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.d_produtos;
CREATE POLICY "Service delete" ON public.d_produtos FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_estoque;
CREATE POLICY "Service delete" ON public.f_estoque FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_forecast_sop;
CREATE POLICY "Service delete" ON public.f_forecast_sop FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_mps_liberacoes;
CREATE POLICY "Service delete" ON public.f_mps_liberacoes FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_mps_producao;
CREATE POLICY "Service delete" ON public.f_mps_producao FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_orcado_liberacao;
CREATE POLICY "Service delete" ON public.f_orcado_liberacao FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_producao_real;
CREATE POLICY "Service delete" ON public.f_producao_real FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_sd2_saidas;
CREATE POLICY "Service delete" ON public.f_sd2_saidas FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service delete" ON public.f_sd3_entradas;
CREATE POLICY "Service delete" ON public.f_sd3_entradas FOR DELETE USING (true);

DROP POLICY IF EXISTS "Service insert" ON public.d_produtos;
CREATE POLICY "Service insert" ON public.d_produtos FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_estoque;
CREATE POLICY "Service insert" ON public.f_estoque FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_forecast_sop;
CREATE POLICY "Service insert" ON public.f_forecast_sop FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_mps_liberacoes;
CREATE POLICY "Service insert" ON public.f_mps_liberacoes FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_mps_producao;
CREATE POLICY "Service insert" ON public.f_mps_producao FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_orcado_liberacao;
CREATE POLICY "Service insert" ON public.f_orcado_liberacao FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_producao_real;
CREATE POLICY "Service insert" ON public.f_producao_real FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_sd2_saidas;
CREATE POLICY "Service insert" ON public.f_sd2_saidas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.f_sd3_entradas;
CREATE POLICY "Service insert" ON public.f_sd3_entradas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service insert" ON public.upload_log;
CREATE POLICY "Service insert" ON public.upload_log FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can write bom" ON public.d_bom_estrutura;
CREATE POLICY "Service role can write bom" ON public.d_bom_estrutura TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can write estoque" ON public.f_estoque_saldo;
CREATE POLICY "Service role can write estoque" ON public.f_estoque_saldo TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can write ops" ON public.f_programacao_ops;
CREATE POLICY "Service role can write ops" ON public.f_programacao_ops TO service_role USING (true);

DROP POLICY IF EXISTS "authenticated all" ON public.f_liberacao_diaria;
CREATE POLICY "authenticated all" ON public.f_liberacao_diaria TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated read" ON public.f_apontamentos;
CREATE POLICY "authenticated read" ON public.f_apontamentos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated read" ON public.f_liberacoes_previstas_sku;
CREATE POLICY "authenticated read" ON public.f_liberacoes_previstas_sku FOR SELECT TO authenticated USING (true);