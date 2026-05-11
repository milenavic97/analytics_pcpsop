import { useState } from "react"

export function useChartLegend(defaultKeys: string[]) {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([])

  function toggleKey(key: string) {
    setHiddenKeys((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key]
    )
  }

  function isVisible(key: string) {
    return !hiddenKeys.includes(key)
  }

  return {
    hiddenKeys,
    toggleKey,
    isVisible,
  }
}
