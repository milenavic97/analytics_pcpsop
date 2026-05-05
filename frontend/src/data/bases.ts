import type { BaseConfig } from "@/types"

export const BASES: BaseConfig[] = [
  {
    id:        "d_produtos",
    label:     "Dimensão Produtos",
    descricao: "Cadastro de produtos com grupo e mercado.",
    colunas:   ["CodProduto", "DescProduto", "Grupo", "Mercado"],
    template:  "template_d_produtos.xlsx",
    icone:     "Package",
  },
  {
    id:        "orcado_liberacao",
    label:     "Orçado de Liberações",
    descricao: "Liberações previstas por linha (L1/L2) e mês para 2026.",
    colunas:   ["Mês", "L1", "L2"],
    template:  "template_orcado_liberacao.xlsx",
    icone:     "CalendarCheck",
  },
  {
    id:        "orcado_faturamento",
    label:     "Orçado de Faturamento",
    descricao: "Orçamento de vendas por produto e mês em caixas.",
    colunas:   ["Cód. Produto", "Descricao Produto", "Grupo de Produto", "Família", "Jan", "Fev", "..."],
    template:  "template_forecast_sop.xlsx",
    icone:     "DollarSign",
  },
  {
    id:        "forecast_sop",
    label:     "Forecast S&OP",
    descricao: "Previsão de vendas por produto e mês.",
    colunas:   ["Cód. Produto", "Descricao Produto", "Grupo de Produto", "Família", "Jan", "Fev", "..."],
    template:  "template_forecast_sop.xlsx",
    icone:     "TrendingUp",
  },
  {
    id:        "sd2_saidas",
    label:     "Vendas Realizadas (SD2)",
    descricao: "Saídas do ERP — armazéns 04/07, grupos anestésicos, sem AVULSO.",
    colunas:   ["Produto", "Descricao", "Quantidade", "Vlr.Total", "Armazem", "Grupo", "Cliente", "Emissao"],
    template:  "template_sd2_saidas.xlsx",
    icone:     "ShoppingCart",
  },
  {
    id:        "sd3_entradas",
    label:     "Entradas Reais (SD3)",
    descricao: "Relatório bruto do Protheus — filtro automático: TP Movimento 499, armazéns 04/07, grupos anestésicos, sem AVULSO.",
    colunas:   ["Filial", "TP Movimento", "Produto", "Descr. Prod", "Lote", "Quantidade", "Armazem", "Grupo", "DT Emissao", "Custo", "Estornado"],
    template:  "template_sd3_entradas.xlsx",
    icone:     "PackageCheck",
  },
  {
    id:        "entradas_previstas",
    label:     "Entradas Previstas",
    descricao: "Liberações previstas por linha e grupo — atualizado semanalmente pelo PCP.",
    colunas:   ["LINHA 1 (CAIXAS)", "Grupo", "Nov", "Dez", "Jan", "Fev", "..."],
    template:  "template_orcado_liberacao.xlsx",
    icone:     "CalendarCheck",
  },
  {
    id:        "estoque",
    label:     "Estoque Início do Mês",
    descricao: "Posição de estoque de PA no início de cada mês.",
    colunas:   ["Produto", "Armazem", "Data Saldo", "Qtd.Inic.Mes"],
    template:  "template_estoque.xlsx",
    icone:     "Warehouse",
  },
  {
    id:        "producao_real",
    label:     "Relatório de Produção",
    descricao: "Apontamentos de produção com eventos, durações e quantidades.",
    colunas:   ["EQUIPAMENTO", "TIPO DE EVENTO", "EVENTO", "PRODUTO", "LOTE",
                "DATA INICIAL", "DATA FINAL", "DURACAO", "QUANTIDADE PRODUZIDA", "QUANTIDADE REJEITADA"],
    template:  "template_producao_real.xlsx",
    icone:     "Factory",
  },
]

export const BASE_MAP = Object.fromEntries(BASES.map((b) => [b.id, b]))