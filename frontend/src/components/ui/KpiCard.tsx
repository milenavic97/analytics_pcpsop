import { type ReactNode } from "react"
import { clsx } from "clsx"

interface Props {
  label:          string
  value:          string
  sub?:           string
  delta?:         string
  deltaPositive?: boolean
  badge?:         ReactNode
  onClick?:       () => void
  className?:     string
  delay?:         number
}

export function KpiCard({ label, value, sub, delta, deltaPositive, badge, onClick, className, delay = 0 }: Props) {
  return (
    <div
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={clsx(
        "card p-5 flex flex-col gap-3 fade-in",
        onClick && "cursor-pointer hover:border-brand-500/30",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="card-label">{label}</span>
        {badge}
      </div>

      <div>
        <p className="card-value">{value}</p>
        {sub && <p className="card-sub">{sub}</p>}
      </div>

      {delta && (
        <div className={clsx("flex items-center gap-1 text-xs font-medium font-mono",
          deltaPositive === true  && "text-success",
          deltaPositive === false && "text-danger",
          deltaPositive == null   && "text-muted",
        )}>
          {deltaPositive === true  && <span>▲</span>}
          {deltaPositive === false && <span>▼</span>}
          <span>{delta}</span>
        </div>
      )}

      {onClick && <p className="text-[10px] text-muted/50 mt-auto">Clique para detalhes</p>}
    </div>
  )
}
