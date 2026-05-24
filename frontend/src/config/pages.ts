import {
  LayoutDashboard,
  Factory,
  ClipboardList,
  Boxes,
  Database,
  CalendarDays,
  ShieldCheck,
} from "lucide-react"

export const APP_PAGES = [
  {
    id: "overview",
    label: "Overview",
    path: "/overview",
    icon: LayoutDashboard,
  },

  {
    id: "producao",
    label: "Produção",
    path: "/producao",
    icon: Factory,
  },

  {
    id: "ordens",
    label: "Ordens",
    path: "/ordens",
    icon: ClipboardList,
  },

  {
    id: "mps",
    label: "MPS / MRP",
    path: "/mps",
    icon: Boxes,
  },

  {
    id: "analise-mrp",
    label: "Análise MRP",
    path: "/analise-mrp",
    icon: Boxes,
  },

  {
    id: "dados",
    label: "Bases de Dados",
    path: "/dados",
    icon: Database,
  },

  {
    id: "calendario-paradas",
    label: "Calendário de Paradas",
    path: "/calendario-paradas",
    icon: CalendarDays,
  },

  {
    id: "configuracoes",
    label: "Configurações",
    path: "/configuracoes",
    icon: ShieldCheck,
  },
] as const

export type AppPageId = typeof APP_PAGES[number]["id"]
