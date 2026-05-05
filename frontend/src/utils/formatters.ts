export const TUBETES_POR_CAIXA = 500

export const tubetesParaCaixas = (t: number) => Math.round(t / TUBETES_POR_CAIXA)

export const fmt = {
  cx: (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n)) + " cx",
  tb: (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n)) + " tb",
  pct: (n: number) => new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1, maximumFractionDigits: 1
  }).format(n) + "%",
  num: (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n)),
  delta: (n: number, unit: "cx" | "tb" = "cx") =>
    `${n >= 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR").format(Math.round(n))} ${unit}`,
}

export const MES_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
