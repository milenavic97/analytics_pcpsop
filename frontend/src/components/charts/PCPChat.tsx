import { useState, useRef, useEffect } from "react"
import { useLocation } from "react-router-dom"
import {
  Send, MessageSquareText, Sparkles,
  X, Minimize2, ShieldCheck,
} from "lucide-react"
import {
  getOpsViabilidade, getOpsResumo,
  getProjecaoFaturamento, getProjecaoLiberacoes,
  getMpsComparativoRealPlanejado, getParadasPareto,
  type ResumoViabilidade, type ResumoPorLinha,
} from "@/services/api"

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  text: string
  time: string
}

type PageContext = {
  page: string
  label: string
  data: Record<string, unknown>
}

type ComponenteAlerta = {
  codigo_comp?: string
  descricao?: string
  tp?: string
  unidade?: string
  necessario?: number
  saldo_lote?: number
  empenho_lote?: number
  saldo_disponivel?: number
  saldo_01?: number
  saldo_98?: number
  saldo_disponivel_98?: number
  faltante?: number
  armazem_ref?: string
  status?: string
}

type OPChat = {
  lote?: string
  codigo?: string
  produto?: string
  linha?: string
  quantidade?: number
  data_fim?: string | null
  op_numero?: string | null
  status?: string
  alertas?: ComponenteAlerta[]
  detalhes?: ComponenteAlerta[]
  resumo_faltas?: string
  qtd_componentes_faltando?: number
  qtd_total_faltante?: number
}

type MaterialCritico = {
  codigo_comp?: string
  descricao?: string
  tp?: string
  unidade?: string
  armazem_ref?: string
  ops_impactadas?: number
  faltante_total?: number
  necessario_total?: number
  status?: string
}

function nowTime() {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date())
}

function fmt(n: number | undefined | null) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Number(n ?? 0))
}

function fmt0(n: number | undefined | null) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(n ?? 0))
}

function getMesAtual() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function linhaLabel(linha?: string) {
  if (linha === "ENVASE_L1") return "Envase L1"
  if (linha === "ENVASE_L2") return "Envase L2"
  if (linha === "EMBALAGEM") return "Embalagem"
  return linha || "Linha não informada"
}

function nomeOP(op: OPChat) {
  const produto = op.produto || op.codigo || "Produto sem descrição"
  const lote = op.lote ? ` — lote ${op.lote}` : ""
  return `${produto}${lote}`
}

function detectPage(pathname: string): string {
  if (pathname.startsWith("/ordens"))   return "ordens"
  if (pathname.startsWith("/producao")) return "producao"
  if (pathname.startsWith("/dados"))    return "dados"
  if (pathname.startsWith("/overview") || pathname === "/") return "overview"
  return "geral"
}

async function loadPageContext(page: string): Promise<PageContext> {
  try {
    if (page === "ordens") {
      const mes = getMesAtual()
      let viabilidade: ResumoViabilidade | null = null
      let resumo: ResumoPorLinha | null = null
      try { viabilidade = await getOpsViabilidade(mes) } catch (_) {}
      try { resumo = await getOpsResumo(mes) } catch (_) {}
      return { page, label: "Ordens de Produção", data: { viabilidade, resumo, mes } }
    }
    if (page === "overview") {
      let fat = null, lib = null
      try { fat = await getProjecaoFaturamento() } catch (_) {}
      try { lib = await getProjecaoLiberacoes() } catch (_) {}
      return { page, label: "Overview", data: { fat, lib } }
    }
    if (page === "producao") {
      let comparativo = null, paretoL1 = null, paretoL2 = null
      try { comparativo = await getMpsComparativoRealPlanejado() } catch (_) {}
      try { paretoL1 = await getParadasPareto("L1") } catch (_) {}
      try { paretoL2 = await getParadasPareto("L2") } catch (_) {}
      return { page, label: "Produção", data: { comparativo, paretoL1, paretoL2 } }
    }
    return { page: "geral", label: "PCP Analytics", data: {} }
  } catch (_) {
    return { page, label: "PCP Analytics", data: {} }
  }
}

function listarFaltasOP(op: OPChat, max = 3) {
  const faltas = (op.alertas ?? []).filter(a => a.status === "falta")
  if (faltas.length === 0) return "sem componente faltante detalhado"
  return faltas.slice(0, max).map(c => {
    const qtd = fmt0(c.faltante)
    const un = c.unidade || "un"
    const desc = c.descricao || c.codigo_comp || "componente"
    return `${qtd} ${un} de ${desc}`
  }).join("; ")
}

function listarQuarentenaOP(op: OPChat, max = 3) {
  const itens = (op.alertas ?? []).filter(a => a.status === "quarentena")
  if (itens.length === 0) return "sem componente em quarentena detalhado"
  return itens.slice(0, max).map(c => {
    const qtd = fmt0(c.faltante)
    const un = c.unidade || "un"
    const desc = c.descricao || c.codigo_comp || "componente"
    return `${qtd} ${un} de ${desc}`
  }).join("; ")
}

function rankingMateriais(ops: OPChat[]) {
  const mapa: Record<string, MaterialCritico> = {}
  ops.forEach(op => {
    ;(op.alertas ?? []).filter(c => c.status === "falta" || c.status === "quarentena").forEach(c => {
      const key = c.codigo_comp || c.descricao || "sem-codigo"
      if (!mapa[key]) {
        mapa[key] = {
          codigo_comp: c.codigo_comp, descricao: c.descricao || c.codigo_comp,
          tp: c.tp, unidade: c.unidade || "un", armazem_ref: c.armazem_ref,
          ops_impactadas: 0, faltante_total: 0, necessario_total: 0, status: c.status,
        }
      }
      mapa[key].ops_impactadas = Number(mapa[key].ops_impactadas ?? 0) + 1
      mapa[key].faltante_total = Number(mapa[key].faltante_total ?? 0) + Number(c.faltante ?? 0)
      mapa[key].necessario_total = Number(mapa[key].necessario_total ?? 0) + Number(c.necessario ?? 0)
      if (c.status === "falta") mapa[key].status = "falta"
    })
  })
  return Object.values(mapa).sort((a, b) => {
    const sa = a.status === "falta" ? 1 : 0
    const sb = b.status === "falta" ? 1 : 0
    if (sb !== sa) return sb - sa
    return Number(b.ops_impactadas ?? 0) - Number(a.ops_impactadas ?? 0)
  })
}

// Remove acentos para comparação mais tolerante
function norm(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function match(q: string, ...termos: string[]): boolean {
  return termos.some(t => q.includes(norm(t)))
}

function gerarResposta(pergunta: string, ctx: PageContext): string {
  const q = norm(pergunta)

  // ── OPs ──────────────────────────────────────────────────────────────────────
  if (ctx.page === "ordens") {
    const v = ctx.data.viabilidade as (ResumoViabilidade & {
      data_estoque?: string
      materiais_criticos?: MaterialCritico[]
      ops?: OPChat[]
    }) | null

    const mes = ctx.data.mes as string

    if (!v) return "Ainda não há dados de OPs para este mês. Faça o upload da programação na aba Dados."

    const resumo = v.resumo
    const ops = (v.ops ?? []) as OPChat[]
    const materiaisCriticos = v.materiais_criticos?.length ? v.materiais_criticos : rankingMateriais(ops)

    const comFalta     = ops.filter(op => op.status === "falta")
    const emQuarentena = ops.filter(op => op.status === "quarentena")
    const podeAbrir    = ops.filter(op => op.status === "ok")
    const abertas      = ops.filter(op => op.status === "aberta")
    const semBom       = ops.filter(op => op.status === "sem_bom")

    // Busca por lote específico (padrão ex: 2605F1026)
    const loteMatch = pergunta.match(/\b([0-9]{4}[A-Za-z][0-9]{4})\b/)
    if (loteMatch) {
      const lote = loteMatch[1].toUpperCase()
      const op = ops.find(o => (o.lote || "").toUpperCase() === lote)
      if (!op) return `Não encontrei nenhuma OP com o lote **${lote}** em ${mes}.`
      const statusLabel: Record<string, string> = {
        aberta: "já aberta no Protheus", ok: "pronta para abrir",
        falta: "com falta de material", quarentena: "aguardando liberação do CQ", sem_bom: "sem BOM cadastrada",
      }
      const detalhe = op.status === "falta" ? `\n\nO que falta: ${listarFaltasOP(op)}`
        : op.status === "quarentena" ? `\n\nEm quarentena: ${listarQuarentenaOP(op)}` : ""
      return `**Lote ${lote}:**\n\n• Produto: **${op.produto || op.codigo}**\n• Linha: **${linhaLabel(op.linha)}**\n• Quantidade: **${fmt0(op.quantidade)}**\n• OP: **${op.op_numero || "sem número"}**\n• Status: **${statusLabel[op.status || ""] || op.status}**${detalhe}`
    }

    // Busca por produto específico mencionado
    const produtoTermos = ["alphacaine", "articaine", "mepivacaine", "mepiadre", "mepisv", "prilonest", "lidocaina", "tubete", "nikadent", "schott", "ompi"]
    const produtoMencionado = produtoTermos.find(p => q.includes(p))
    if (produtoMencionado && !match(q, "resumo", "geral", "quantas", "situacao")) {
      const opsP = ops.filter(op =>
        norm(op.produto || "").includes(produtoMencionado) || norm(op.codigo || "").includes(produtoMencionado)
      )
      if (opsP.length === 0) return `Não encontrei OPs de **${produtoMencionado}** na programação de ${mes}.`
      const ok = opsP.filter(op => op.status === "ok").length
      const falta = opsP.filter(op => op.status === "falta").length
      const quar = opsP.filter(op => op.status === "quarentena").length
      const aberta = opsP.filter(op => op.status === "aberta").length
      const lista = opsP.slice(0, 6).map(op => {
        const s = op.status === "aberta" ? "Aberta" : op.status === "ok" ? "Pode abrir" : op.status === "falta" ? "Falta mat." : "Quarentena"
        return `• Lote **${op.lote}** (${linhaLabel(op.linha)}) — ${s}`
      }).join("\n")
      return `**OPs de ${produtoMencionado.toUpperCase()} em ${mes}:**\n\n• Total: **${opsP.length}** | Abertas: **${aberta}** | Podem abrir: **${ok}** | Falta: **${falta}** | Quarentena: **${quar}**\n\n${lista}${opsP.length > 6 ? `\n...e mais ${opsP.length - 6} OPs.` : ""}`
    }

    // Resumo geral
    if (match(q, "resumo", "geral", "quantas", "situacao", "como esta", "como estao", "overview", "panorama", "visao geral", "status")) {
      const linhas = ["ENVASE_L1", "ENVASE_L2", "EMBALAGEM"].map(linha => {
        const l = ops.filter(op => op.linha === linha)
        if (l.length === 0) return null
        const ok = l.filter(op => op.status === "ok").length
        const falta = l.filter(op => op.status === "falta").length
        const quar = l.filter(op => op.status === "quarentena").length
        const aberta = l.filter(op => op.status === "aberta").length
        return `• **${linhaLabel(linha)}:** ${l.length} OPs | ${aberta} abertas | ${ok} podem abrir | ${falta} falta | ${quar} quarentena`
      }).filter(Boolean).join("\n")
      const dataEstoque = v.data_estoque ? `\n\nBase de estoque: **${v.data_estoque}**` : ""
      return `**Resumo das OPs — ${mes}:**\n\n• Abertas no Protheus: **${resumo.abertas}**\n• Prontas para abrir: **${resumo.ok}**\n• Quarentena/CQ: **${resumo.quarentena}**\n• Falta de material: **${resumo.falta}**\n• Sem BOM: **${resumo.sem_bom ?? 0}**\n\nTotal: **${v.total_ops} OPs**\n\n${linhas}${dataEstoque}`
    }

    // Falta de material
    if (match(q, "falta", "faltando", "gargalo", "critico", "bloqueada", "bloqueado", "problema", "restricao", "sem material", "insuficiente", "nao tem", "o que falta", "o que esta faltando")) {
      if (comFalta.length === 0) {
        if (emQuarentena.length > 0) return `Não há falta real, mas **${emQuarentena.length} OP(s)** dependem de liberação do CQ.`
        return "Nenhuma OP com falta de material no momento."
      }
      const listaOps = comFalta.slice(0, 5).map(op =>
        `• **${nomeOP(op)}** (${linhaLabel(op.linha)}): ${listarFaltasOP(op)}`
      ).join("\n")
      const topMat = materiaisCriticos.filter(m => m.status === "falta").slice(0, 5).map(m =>
        `• **${m.descricao || m.codigo_comp}**: falta **${fmt0(m.faltante_total)} ${m.unidade || "un"}** — **${m.ops_impactadas} OP(s)**`
      ).join("\n")
      return `**${comFalta.length} OP(s) bloqueadas:**\n\n${listaOps}${comFalta.length > 5 ? `\n...e mais ${comFalta.length - 5} OPs.` : ""}\n\n**Materiais críticos:**\n${topMat || "Sem detalhes."}`
    }

    // Ranking de materiais
    if (match(q, "material critico", "materiais criticos", "ranking", "mais critico", "top material", "quais materiais", "principal material")) {
      if (materiaisCriticos.length === 0) return "Nenhum material crítico identificado."
      const lista = materiaisCriticos.slice(0, 8).map((m, i) =>
        `${i + 1}. **${m.descricao || m.codigo_comp}** — falta **${fmt0(m.faltante_total)} ${m.unidade || "un"}** — **${m.ops_impactadas} OP(s)**`
      ).join("\n")
      return `**Ranking de materiais críticos:**\n\n${lista}`
    }

    // Quarentena
    if (match(q, "quarentena", "cq", "aguardando", "liberacao", "liberar", "armazem 98")) {
      if (emQuarentena.length === 0) return "Nenhuma OP dependendo de quarentena no momento."
      const lista = emQuarentena.slice(0, 5).map(op =>
        `• **${nomeOP(op)}** (${linhaLabel(op.linha)}): ${listarQuarentenaOP(op)}`
      ).join("\n")
      return `**${emQuarentena.length} OP(s) aguardando CQ:**\n\n${lista}${emQuarentena.length > 5 ? `\n...e mais ${emQuarentena.length - 5} OPs.` : ""}`
    }

    // Prontas para abrir
    if (match(q, "pode abrir", "podem abrir", "disponivel", "pronta", "prontas", "abrir agora", "verde", "liberada", "ok")) {
      if (podeAbrir.length === 0) return "Nenhuma OP pronta para abrir no momento."
      const lista = podeAbrir.slice(0, 8).map(op =>
        `• **${nomeOP(op)}** — ${linhaLabel(op.linha)} — ${fmt0(op.quantidade)} un`
      ).join("\n")
      return `**${podeAbrir.length} OP(s) prontas para abrir:**\n\n${lista}${podeAbrir.length > 8 ? `\n...e mais ${podeAbrir.length - 8} OPs.` : ""}`
    }

    // Abertas no Protheus
    if (match(q, "aberta", "abertas", "emitida", "emitidas", "protheus", "numero de op", "op numero", "ja tem op")) {
      if (abertas.length === 0) return "Nenhuma OP emitida no Protheus para este mês."
      return `**${abertas.length} OP(s) já emitidas no Protheus** para ${mes}.`
    }

    // Urgentes / vencendo
    if (match(q, "urgente", "vencendo", "prazo", "data fim", "proximo", "esta semana", "hoje", "amanha", "atrasada", "atrasado")) {
      const hoje = new Date()
      const em7dias = new Date()
      em7dias.setDate(hoje.getDate() + 7)
      const urgentes = ops
        .filter(op => op.data_fim && op.status !== "aberta" && new Date(op.data_fim) <= em7dias)
        .sort((a, b) => new Date(a.data_fim!).getTime() - new Date(b.data_fim!).getTime())
      if (urgentes.length === 0) return "Nenhuma OP com data fim nos próximos 7 dias pendente de abertura."
      const lista = urgentes.slice(0, 6).map(op => {
        const d = new Date(op.data_fim!)
        const dataStr = d.toLocaleDateString("pt-BR")
        const s = op.status === "ok" ? "Pronta" : op.status === "falta" ? "Falta mat." : "Quarentena"
        return `• **${nomeOP(op)}** — ${dataStr} — ${s}`
      }).join("\n")
      return `**${urgentes.length} OP(s) com vencimento nos próximos 7 dias:**\n\n${lista}`
    }

    // Sem BOM
    if (match(q, "bom", "estrutura", "sem bom", "cadastro")) {
      if (semBom.length === 0) return "Nenhuma OP sem BOM encontrada."
      const lista = semBom.slice(0, 6).map(op => `• **${nomeOP(op)}** — ${linhaLabel(op.linha)} — código ${op.codigo}`).join("\n")
      return `**${semBom.length} OP(s) sem BOM:**\n\n${lista}`
    }

    // Por linha
    if (match(q, "envase", "l1", "linha 1", "linha1")) {
      const l = ops.filter(op => op.linha === "ENVASE_L1")
      const ok = l.filter(op => op.status === "ok").length
      const falta = l.filter(op => op.status === "falta").length
      const quar = l.filter(op => op.status === "quarentena").length
      const aberta = l.filter(op => op.status === "aberta").length
      const topF = comFalta.filter(op => op.linha === "ENVASE_L1").slice(0, 3).map(op => `• ${nomeOP(op)}: ${listarFaltasOP(op, 2)}`).join("\n")
      return `**Envase L1 — ${mes}:**\n\n• Total: **${l.length}** OPs\n• Abertas: **${aberta}** | Podem abrir: **${ok}** | Falta: **${falta}** | Quarentena: **${quar}**${topF ? `\n\nRestrições:\n${topF}` : ""}`
    }

    if (match(q, "l2", "linha 2", "linha2")) {
      const l = ops.filter(op => op.linha === "ENVASE_L2")
      const ok = l.filter(op => op.status === "ok").length
      const falta = l.filter(op => op.status === "falta").length
      const quar = l.filter(op => op.status === "quarentena").length
      const aberta = l.filter(op => op.status === "aberta").length
      const topF = comFalta.filter(op => op.linha === "ENVASE_L2").slice(0, 3).map(op => `• ${nomeOP(op)}: ${listarFaltasOP(op, 2)}`).join("\n")
      return `**Envase L2 — ${mes}:**\n\n• Total: **${l.length}** OPs\n• Abertas: **${aberta}** | Podem abrir: **${ok}** | Falta: **${falta}** | Quarentena: **${quar}**${topF ? `\n\nRestrições:\n${topF}` : ""}`
    }

    if (match(q, "embalagem")) {
      const l = ops.filter(op => op.linha === "EMBALAGEM")
      const ok = l.filter(op => op.status === "ok").length
      const falta = l.filter(op => op.status === "falta").length
      const quar = l.filter(op => op.status === "quarentena").length
      const aberta = l.filter(op => op.status === "aberta").length
      const topF = comFalta.filter(op => op.linha === "EMBALAGEM").slice(0, 3).map(op => `• ${nomeOP(op)}: ${listarFaltasOP(op, 2)}`).join("\n")
      return `**Embalagem — ${mes}:**\n\n• Total: **${l.length}** OPs\n• Abertas: **${aberta}** | Podem abrir: **${ok}** | Falta: **${falta}** | Quarentena: **${quar}**${topF ? `\n\nRestrições:\n${topF}` : ""}`
    }

    return `Posso te ajudar com:\n\n• **"Resumo geral"** — situação de todas as OPs\n• **"O que está faltando?"** — materiais bloqueando OPs\n• **"Materiais críticos"** — ranking de faltas\n• **"OPs em quarentena"** — dependentes do CQ\n• **"Quais podem abrir agora?"**\n• **"OPs urgentes"** — vencendo em 7 dias\n• **"Como está o Envase L1?"**\n• **"Lote 2605F1026"** — busca por lote específico`
  }

  // ── Overview ──────────────────────────────────────────────────────────────────
  if (ctx.page === "overview") {
    const fat = ctx.data.fat as Record<string, number> | null
    const lib = ctx.data.lib as Record<string, number> | null

    if (!fat && !lib) return "Dados do overview ainda não carregados."

    if (match(q, "faturamento", "fat", "vendas", "receita")) {
      if (!fat) return "Dados de faturamento não disponíveis."
      const pct = fat.pct_atingimento ?? 0
      const status = pct >= 100 ? "acima do orçado" : pct >= 95 ? "dentro da meta" : "abaixo da meta"
      return `**Faturamento 2026:**\n\n• Projetado: **${fmt(fat.total_projetado ?? 0)} cx**\n• Orçado: **${fmt(fat.total_orcado ?? 0)} cx**\n• Atingimento: **${pct.toFixed(1)}%** — ${status}\n• Gap: **${fmt(fat.delta_caixas ?? 0)} cx**`
    }

    if (match(q, "liberacao", "liberacoes", "lib", "entradas", "lancamento")) {
      if (!lib) return "Dados de liberações não disponíveis."
      const pct = lib.pct_atingimento ?? 0
      const status = pct >= 100 ? "acima do orçado" : pct >= 95 ? "dentro da meta" : "abaixo da meta"
      return `**Liberações 2026:**\n\n• Projetado: **${fmt(lib.total_projetado ?? 0)} cx**\n• Orçado: **${fmt(lib.total_orcado ?? 0)} cx**\n• Atingimento: **${pct.toFixed(1)}%** — ${status}\n• Gap: **${fmt(lib.delta_caixas ?? 0)} cx**`
    }

    if (match(q, "resumo", "geral", "como", "overview", "situacao", "atingimento")) {
      const pctFat = fat?.pct_atingimento ?? 0
      const pctLib = lib?.pct_atingimento ?? 0
      return `**Resumo executivo 2026:**\n\n• Faturamento: **${pctFat.toFixed(1)}%** do orçado\n• Liberações: **${pctLib.toFixed(1)}%** do orçado`
    }

    return `Posso te ajudar com:\n\n• **"Como está o faturamento?"**\n• **"Como estão as liberações?"**\n• **"Resumo geral"**`
  }

  // ── Produção ──────────────────────────────────────────────────────────────────
  if (ctx.page === "producao") {
    const paretoL1 = ctx.data.paretoL1 as { items: Array<Record<string, unknown>> } | null
    const paretoL2 = ctx.data.paretoL2 as { items: Array<Record<string, unknown>> } | null

    const itemsL1 = paretoL1?.items ?? []
    const itemsL2 = paretoL2?.items ?? []
    const totalL1 = itemsL1.reduce((acc, i) => acc + Number(i.horas ?? 0), 0)
    const totalL2 = itemsL2.reduce((acc, i) => acc + Number(i.horas ?? 0), 0)
    const topL1 = [...itemsL1].sort((a, b) => Number(b.horas ?? 0) - Number(a.horas ?? 0))
    const topL2 = [...itemsL2].sort((a, b) => Number(b.horas ?? 0) - Number(a.horas ?? 0))

    if (match(q, "l1", "linha 1", "linha1", "envase 1")) {
      if (!topL1[0]) return "Sem dados de paradas da L1."
      const top3 = topL1.slice(0, 3).map((i, idx) => {
        const p = totalL1 > 0 ? (Number(i.horas ?? 0) / totalL1) * 100 : 0
        return `${idx + 1}. **${i.evento ?? i.motivo ?? "-"}** — ${fmt(Number(i.horas ?? 0))} h (${fmt(p)}%)`
      }).join("\n")
      return `**Paradas da L1:**\n\nTotal: **${fmt(totalL1)} h**\n\n${top3}`
    }

    if (match(q, "l2", "linha 2", "linha2", "envase 2")) {
      if (!topL2[0]) return "Sem dados de paradas da L2."
      const top3 = topL2.slice(0, 3).map((i, idx) => {
        const p = totalL2 > 0 ? (Number(i.horas ?? 0) / totalL2) * 100 : 0
        return `${idx + 1}. **${i.evento ?? i.motivo ?? "-"}** — ${fmt(Number(i.horas ?? 0))} h (${fmt(p)}%)`
      }).join("\n")
      return `**Paradas da L2:**\n\nTotal: **${fmt(totalL2)} h**\n\n${top3}`
    }

    if (match(q, "compar", "qual linha", "mais parada", "pior", "critica", "resumo", "geral")) {
      const piorLinha = totalL1 >= totalL2 ? "L1" : "L2"
      return `**Comparativo de paradas:**\n\n• L1: **${fmt(totalL1)} h**\n• L2: **${fmt(totalL2)} h**\n\nLinha mais crítica: **${piorLinha}**`
    }

    return `Posso te ajudar com:\n\n• **"Paradas da L1"**\n• **"Como está a L2?"**\n• **"Qual linha tem mais perdas?"**`
  }

  return `Sou o PCP Chat! Posso ajudar com:\n\n• **Ordens de Produção** — faltas, quarentena, viabilidade\n• **Overview** — faturamento e liberações\n• **Produção** — paradas e aderência\n\nNavegue até a página desejada e me faça uma pergunta.`
}

function renderText(text: string, isUser: boolean) {
  return text.split("\n").map((line, li) => (
    <span key={li} className="block">
      {line.split("**").map((part, i) =>
        i % 2 === 1
          ? <strong key={i} style={{ color: isUser ? "#fff" : "#1B3A5C" }}>{part}</strong>
          : <span key={i}>{part}</span>
      )}
    </span>
  ))
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm"
        style={{
          background: isUser ? "#1B3A5C" : "#FFFFFF",
          color: isUser ? "#FFFFFF" : "var(--text-primary)",
          border: isUser ? "none" : "1px solid var(--border)",
        }}
      >
        {renderText(message.text, isUser)}
        <div className="mt-2 text-[11px]" style={{ opacity: 0.6 }}>{message.time}</div>
      </div>
    </div>
  )
}

export function PCPChat() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [ctx, setCtx] = useState<PageContext | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      time: nowTime(),
      text: "Olá! Sou o PCP Chat.\n\nPosso responder sobre OPs, faturamento, liberações e paradas de produção com base nos dados reais.",
    },
  ])
  const bottomRef = useRef<HTMLDivElement>(null)

  const page = detectPage(location.pathname)

  useEffect(() => {
    if (!open) return
    setCtx(null)
    loadPageContext(page).then(setCtx)
  }, [open, page])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function handleSend() {
    const pergunta = input.trim()
    if (!pergunta || loading) return

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: pergunta, time: nowTime() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)

    let contexto = ctx
    if (!contexto) contexto = await loadPageContext(page)

    const resposta = gerarResposta(pergunta, contexto)
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", text: resposta, time: nowTime() }
    setMessages(prev => [...prev, assistantMsg])
    setLoading(false)
  }

  const pageLabels: Record<string, string> = {
    ordens: "OPs", overview: "Overview", producao: "Produção", dados: "Dados", geral: "PCP",
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[999] flex items-center gap-3 rounded-full px-4 py-3 shadow-2xl transition-all hover:scale-[1.02] md:bottom-6 md:right-6"
          style={{ background: "#1B3A5C", color: "#FFFFFF" }}
        >
          <MessageSquareText size={20} />
          <div className="hidden text-left sm:block">
            <div className="text-sm font-bold">PCP Chat</div>
            <div className="text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>
              {pageLabels[page] || "PCP"} · Online
            </div>
          </div>
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-0 right-0 z-[999] flex h-[100svh] w-full flex-col overflow-hidden border shadow-2xl md:bottom-6 md:right-6 md:h-[680px] md:w-[460px] md:rounded-2xl"
          style={{ background: "#FFFFFF", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between px-5 py-4" style={{ background: "#1B3A5C", color: "#FFFFFF" }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.14)" }}>
                <MessageSquareText size={20} />
              </div>
              <div>
                <h2 className="text-sm font-bold">PCP Chat</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                  {ctx ? ctx.label : "Carregando contexto..."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.12)" }}>
                <Minimize2 size={16} />
              </button>
              <button onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.12)" }}>
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" style={{ background: "#F8FAFC" }}>
            {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: "#FFFFFF", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  <span className="animate-pulse">Analisando dados do PCP...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t p-3" style={{ borderColor: "var(--border)", background: "#FFFFFF" }}>
            <div className="flex items-center gap-2 rounded-2xl border p-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#EEF2FF", color: "#1B3A5C" }}>
                <Sparkles size={18} />
              </div>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSend() }}
                placeholder="Ex: o que está faltando?"
                className="flex-1 bg-transparent text-sm outline-none"
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-40"
                style={{ background: "#1B3A5C", color: "#FFFFFF" }}
              >
                <Send size={18} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-center gap-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
              <ShieldCheck size={12} />
              Respostas baseadas nos dados reais
            </div>
          </div>
        </div>
      )}
    </>
  )
}
