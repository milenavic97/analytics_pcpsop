import { chartTheme } from "@/styles/chartTheme"

type TooltipPayload = {
  color?: string
  name?: string
  value?: number | string
  payload?: Record<string, any>
}

type Props = {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
  formatter?: (value: number | string, name: string) => string
}

function defaultFormatter(value: number | string) {
  if (typeof value === "number") {
    return new Intl.NumberFormat("pt-BR").format(value)
  }

  return value
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: Props) {
  if (!active || !payload?.length) {
    return null
  }

  return (
    <div
      className="min-w-[180px] rounded-xl border px-4 py-3 shadow-sm"
      style={{
        background: chartTheme.tooltipBg,
        borderColor: chartTheme.border,
      }}
    >
      {label && (
        <div
          className="mb-3 text-xs font-semibold uppercase tracking-wide"
          style={{
            color: chartTheme.text,
          }}
        >
          {label}
        </div>
      )}

      <div className="space-y-2">
        {payload.map((item, index) => (
          <div
            key={`${item.name}-${index}`}
            className="flex items-center justify-between gap-6"
          >
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background: item.color || chartTheme.blueDark,
                }}
              />

              <span
                className="text-xs"
                style={{
                  color: chartTheme.text,
                }}
              >
                {item.name}
              </span>
            </div>

            <span
              className="text-xs font-semibold"
              style={{
                color: chartTheme.textStrong,
              }}
            >
              {formatter
                ? formatter(item.value || 0, item.name || "")
                : defaultFormatter(item.value || 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
