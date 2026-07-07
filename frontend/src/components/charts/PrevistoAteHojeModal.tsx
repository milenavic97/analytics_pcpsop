"use client"

import { X } from "lucide-react"

type Item = {
  grupo: string
  previsto_ate_hoje: number
  realizado_mtd: number
}

type Props = {
  open: boolean
  onClose: () => void
  data: Item[]
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value || 0)
}

export default function PrevistoAteHojeModal({
  open,
  onClose,
  data,
}: Props) {

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">

      <div className="w-[1100px] max-w-[95vw] rounded-3xl bg-white shadow-2xl overflow-hidden">

        {/* HEADER */}
        <div className="bg-[#17375E] px-6 py-5 flex items-center justify-between">

          <div>
            <p className="text-xs uppercase tracking-wider text-white/70">
              Liberações — MTD
            </p>

            <h2 className="text-2xl font-bold text-white">
              Previsto até Hoje
            </h2>
          </div>

          <button
            onClick={onClose}
            className="h-11 w-11 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6">

          <div className="overflow-auto rounded-2xl border border-slate-200">

            <table className="w-full text-sm">

              <thead className="bg-slate-100 text-slate-600 uppercase text-xs">

                <tr>
                  <th className="px-4 py-3 text-left">
                    Grupo
                  </th>

                  <th className="px-4 py-3 text-right">
                    Previsto até Hoje
                  </th>

                  <th className="px-4 py-3 text-right">
                    Realizado MTD
                  </th>

                  <th className="px-4 py-3 text-right">
                    Diferença
                  </th>

                  <th className="px-4 py-3 text-center">
                    Status
                  </th>
                </tr>

              </thead>

              <tbody>

                {data.map((item, idx) => {

                  const diff =
                    item.realizado_mtd -
                    item.previsto_ate_hoje

                  const ok = diff >= 0

                  return (
                    <tr
                      key={idx}
                      className="border-t border-slate-100 hover:bg-slate-50 transition"
                    >

                      <td className="px-4 py-4 font-semibold text-slate-800">
                        {item.grupo}
                      </td>

                      <td className="px-4 py-4 text-right text-slate-700">
                        {formatNumber(item.previsto_ate_hoje)}
                      </td>

                      <td className="px-4 py-4 text-right font-semibold text-slate-900">
                        {formatNumber(item.realizado_mtd)}
                      </td>

                      <td
                        className={`px-4 py-4 text-right font-bold ${
                          ok
                            ? "text-green-600"
                            : "text-red-500"
                        }`}
                      >
                        {formatNumber(diff)}
                      </td>

                      <td className="px-4 py-4 text-center">

                        {ok ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                            OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-600">
                            Abaixo
                          </span>
                        )}

                      </td>

                    </tr>
                  )
                })}

              </tbody>

            </table>

          </div>

        </div>

      </div>

    </div>
  )
}
