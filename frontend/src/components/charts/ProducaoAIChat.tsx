import { useMemo, useRef, useState } from "react"
import {
  Send,
  MessageSquareText,
  Sparkles,
  X,
  Minimize2,
  ShieldCheck,
} from "lucide-react"

import { chartTheme } from "@/styles/chartTheme"
import type { ParadaParetoItem } from "@/components/charts/ParadasParetoChart"

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  text: string
  time: string
}

type Props = {
  dataL1?: ParadaParetoItem[]
  dataL2?: ParadaParetoItem[]
}

function nowTime() {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date())
}

function fmtHoras(value: number | string) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0))} h`
}

function fmtPct(value: number | string) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0))}%`
}

function getLabel(item?: ParadaParetoItem) {
  return item?.evento || item?.motivo || item?.tipo_evento || "-"
}

function totalHoras(items: ParadaParetoItem[]) {
  return items.reduce((acc, item) => acc + Number(item.horas || 0), 0)
}

function topItem(items: ParadaParetoItem[]) {
  return [...items].sort((a, b) => Number(b.horas || 0) - Number(a.horas || 0))[0]
}

function respostaLocal(
  pergunta: string,
  dataL1: ParadaParetoItem[],
  dataL2: ParadaParetoItem[]
) {
  const q = pergunta.toLowerCase()

  const l1Top = topItem(dataL1)
  const l2Top = topItem(dataL2)

  const l1Total = totalHoras(dataL1)
  const l2Total = totalHoras(dataL2)

  if (q.includes("l1") || q.includes("linha 1")) {
    if (!l1Top) return "Ainda não encontrei dados suficientes da L1."

    const pct = l1Total > 0 ? (Number(l1Top.horas || 0) / l1Total) * 100 : 0

    return `O maior motivo de parada da L1 foi **${getLabel(l1Top)}**.\n\n• Horas: **${fmtHoras(l1Top.horas)}**\n• Ocorrências: **${l1Top.ocorrencias.toLocaleString("pt-BR")}**\n• Representa: **${fmtPct(pct)}** da linha.`
  }

  if (q.includes("l2") || q.includes("linha 2")) {
    if (!l2Top) return "Ainda não encontrei dados suficientes da L2."

    const pct = l2Total > 0 ? (Number(l2Top.horas || 0) / l2Total) * 100 : 0

    return `O maior motivo de parada da L2 foi **${getLabel(l2Top)}**.\n\n• Horas: **${fmtHoras(l2Top.horas)}**\n• Ocorrências: **${l2Top.ocorrencias.toLocaleString("pt-BR")}**\n• Representa: **${fmtPct(pct)}** da linha.`
  }

  if (
    q.includes("compar") ||
    q.includes("qual linha") ||
    q.includes("mais parada")
  ) {
    const linhaMaisCritica = l1Total >= l2Total ? "L1" : "L2"

    return `A linha com mais perdas atualmente é a **${linhaMaisCritica}**.\n\n• L1: **${fmtHoras(l1Total)}**\n• L2: **${fmtHoras(l2Total)}**`
  }

  return "Posso comparar linhas, mostrar maiores perdas, eventos críticos e explicar concentração das paradas."
}

function renderBoldText(text: string, isUser: boolean) {
  return text.split("**").map((part, index) =>
    index % 2 === 1 ? (
      <strong
        key={index}
        style={{ color: isUser ? "#FFFFFF" : chartTheme.blueDark }}
      >
        {part}
      </strong>
    ) : (
      <span key={index}>{part}</span>
    )
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm"
        style={{
          background: isUser ? chartTheme.blueDark : "#FFFFFF",
          color: isUser ? "#FFFFFF" : "var(--text-primary)",
          border: isUser ? "none" : "1px solid var(--border)",
        }}
      >
        {renderBoldText(message.text, isUser)}

        <div className="mt-2 text-[11px]" style={{ opacity: 0.7 }}>
          {message.time}
        </div>
      </div>
    </div>
  )
}

export function ProducaoAIChat({ dataL1 = [], dataL2 = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  const initialMessages = useMemo<ChatMessage[]>(
    () => [
      {
        id: "welcome",
        role: "assistant",
        time: nowTime(),
        text:
          "Olá! 👋\nSou a IA de Produção.\n\nPosso te ajudar a entender perdas, comparar linhas e identificar oportunidades.",
      },
    ],
    []
  )

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)

  function sendQuestion(question: string) {
    const pergunta = question.trim()
    if (!pergunta) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: pergunta,
      time: nowTime(),
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: respostaLocal(pergunta, dataL1, dataL2),
      time: nowTime(),
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput("")
  }

  function handleSend() {
    sendQuestion(input)
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[999] flex items-center gap-3 rounded-full px-4 py-3 shadow-2xl transition-all hover:scale-[1.02] md:bottom-6 md:right-6"
          style={{
            background: chartTheme.blueDark,
            color: "#FFFFFF",
          }}
        >
          <MessageSquareText size={20} />

          <div className="hidden text-left sm:block">
            <div className="text-sm font-bold">IA de Produção</div>

            <div
              className="text-[11px]"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              Online agora
            </div>
          </div>
        </button>
      )}

      {open && (
        <div
          className="
            fixed bottom-0 right-0 z-[999]
            flex h-[100svh] w-full flex-col
            overflow-hidden border shadow-2xl
            md:bottom-6 md:right-6
            md:h-[680px] md:w-[460px] md:rounded-2xl
          "
          style={{
            background: "#FFFFFF",
            borderColor: "var(--border)",
          }}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{
              background: chartTheme.blueDark,
              color: "#FFFFFF",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.14)" }}
              >
                <MessageSquareText size={20} />
              </div>

              <div>
                <h2 className="text-sm font-bold">IA de Produção</h2>

                <p
                  className="text-xs"
                  style={{ color: "rgba(255,255,255,0.75)" }}
                >
                  Online agora
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.12)" }}
              >
                <Minimize2 size={16} />
              </button>

              <button
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.12)" }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
            style={{ background: "#F8FAFC" }}
          >
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>

          <div
            className="border-t p-3"
            style={{
              borderColor: "var(--border)",
              background: "#FFFFFF",
            }}
          >
            <div
              className="flex items-center gap-2 rounded-2xl border p-2"
              style={{ borderColor: "var(--border)" }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: "#EEF2FF",
                  color: chartTheme.blueDark,
                }}
              >
                <Sparkles size={18} />
              </div>

              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend()
                }}
                placeholder="Digite sua pergunta..."
                className="flex-1 bg-transparent text-sm outline-none"
              />

              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-50"
                style={{
                  background: chartTheme.blueDark,
                  color: "#FFFFFF",
                }}
              >
                <Send size={18} />
              </button>
            </div>

            <div
              className="mt-2 flex items-center justify-center gap-1 text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              <ShieldCheck size={12} />
              Respostas baseadas nos dados disponíveis
            </div>
          </div>
        </div>
      )}
    </>
  )
}
