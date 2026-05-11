// frontend/src/services/buildLiberacoesDataset.ts

export type LiberacaoRegistro = {
  mes: number
  ano: number
  linha: 'L1' | 'L2'
  realizado: number
  planejado: number
  orcado: number
}

type InputReal = {
  data: string
  lote: string
  quantidade: number
}

type InputPlanejado = {
  mes: number
  ano: number
  linha: 'L1' | 'L2'
  quantidade: number
}

type InputOrcado = {
  mes: number
  ano: number
  linha: 'L1' | 'L2'
  quantidade: number
}

const getLinhaFromLote = (lote: string): 'L1' | 'L2' | null => {
  if (!lote) return null

  const match = lote.match(/[A-Za-z](\d)/)
  if (!match) return null

  if (match[1] === '1') return 'L1'
  if (match[1] === '2') return 'L2'

  return null
}

const getMesAno = (date: string) => {
  const d = new Date(date)
  return {
    mes: d.getMonth() + 1,
    ano: d.getFullYear()
  }
}

export function buildLiberacoesDataset(
  realizados: InputReal[],
  planejados: InputPlanejado[],
  orcados: InputOrcado[]
): LiberacaoRegistro[] {

  const map = new Map<string, LiberacaoRegistro>()

  const getKey = (mes: number, ano: number, linha: 'L1' | 'L2') =>
    `${ano}-${mes}-${linha}`

  const ensure = (mes: number, ano: number, linha: 'L1' | 'L2') => {
    const key = getKey(mes, ano, linha)

    if (!map.has(key)) {
      map.set(key, {
        mes,
        ano,
        linha,
        realizado: 0,
        planejado: 0,
        orcado: 0
      })
    }

    return map.get(key)!
  }

  // 🔵 REALIZADO (SD3)
  for (const r of realizados) {
    const linha = getLinhaFromLote(r.lote)
    if (!linha) continue

    const { mes, ano } = getMesAno(r.data)
    const row = ensure(mes, ano, linha)

    row.realizado += Number(r.quantidade || 0)
  }

  // ⚪ PLANEJADO
  for (const p of planejados) {
    const row = ensure(p.mes, p.ano, p.linha)

    row.planejado += Number(p.quantidade || 0)
  }

  // 🟠 ORÇADO
  for (const o of orcados) {
    const row = ensure(o.mes, o.ano, o.linha)

    row.orcado += Number(o.quantidade || 0)
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.ano !== b.ano) return a.ano - b.ano
    if (a.mes !== b.mes) return a.mes - b.mes
    return a.linha.localeCompare(b.linha)
  })
}
