import { chartTheme } from "@/styles/chartTheme"

type LegendItem = {
  key: string
  label: string
  color: string
}

type Props = {
  items: LegendItem[]
  hiddenKeys: string[]
  onToggle: (key: string) => void
}

export function ChartLegend({
  items,
  hiddenKeys,
  onToggle,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const active = !hiddenKeys.includes(item.key)

        return (
          <button
            key={item.key}
            onClick={() => onToggle(item.key)}
            className="flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all"
            style={{
              borderColor: chartTheme.border,
              background: active
                ? chartTheme.grayLight
                : "transparent",
              opacity: active ? 1 : 0.45,
            }}
          >
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: item.color,
              }}
            />

            <span
              className="text-xs font-medium"
              style={{
                color: chartTheme.textStrong,
              }}
            >
              {item.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
