import {
  LayoutDashboard,
  Factory,
  ClipboardList,
  Boxes,
  PackageSearch,
  DatabaseBackup,
  CalendarDays,
  ShieldCheck,
  DollarSign,
  AlertTriangle,
  PackageCheck,
} from "lucide-react"

export const APP_PAGES = [
  {
    id: "overview",
    label: "Overview",
    path: "/overview",
    icon: LayoutDashboard,
  },

  {
    id: "liberacao-executiva",
    label: "Liberação Executiva",
    path: "/liberacao-executiva",
    icon: PackageCheck,
  },

  {
    id: "producao",
    label: "Produção",
    path: "/producao",
    icon: Factory,
  },

  {
    id: "faturamento",
    label: "Faturamento",
    path: "/faturamento",
    icon: DollarSign,
  },

  {
    id: "desvios",
    label: "Desvios",
    path: "/desvios",
    icon: AlertTriangle,
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
    label: "Gestão de Estoques",
    path: "/analise-mrp",
    icon: PackageSearch,
  },

  {
    id: "dados",
    label: "Bases de Dados",
    path: "/dados",
    icon: DatabaseBackup,
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
