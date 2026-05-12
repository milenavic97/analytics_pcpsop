import { useState, useRef, useEffect } from "react"
import { useLocation } from "react-router-dom"
import {
  Send,
  MessageSquareText,
  Sparkles,
  X,
  Minimize2,
  ShieldCheck,
} from "lucide-react"

const API_URL =
  (import.meta as any).env.VITE_API_URL || "https://dfl-sop-api.fly.dev"

type ChatMessage = {
  id: string
  role: "assistant" | "user"
  text: string
  time: string
}

function nowTime() {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date())
}

function getMesAtual() {
  const now = new Date()

  return `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`
}

function detectPage(pathname: string): string {
  if (pathname.startsWith("/ordens")) return "ordens"
  if (pathname.startsWith("/producao")) return "producao"
  if (pathname.startsWith("/dados")) return "dados"
  if (pathname.startsWith("/overview") || pathname === "/")
    return "overview"

  return "geral"
}

const PAGE_LABELS: Record<string, string> = {
  ordens: "OPs",
  overview: "Overview",
  producao: "Produção",
  dados: "Dados",
  geral: "PCP",
}

const SUGESTOES: Record<string, string[]> = {
  ordens: [
    "Resumo geral das OPs",
    "O que está faltando?",
    "Quais podem abrir agora?",
    "OPs em quarentena",
  ],

  overview: [
    "Como estão as liberações?",
    "Como está o faturamento?",
    "Resumo executivo do mês",
  ],

  producao: [
    "Paradas da L1",
    "Paradas da L2",
    "Qual linha tem mais perdas?",
  ],

  geral: [
    "Resumo geral",
    "OPs críticas do mês",
    "Como está o faturamento?",
  ],

  dados: ["Como usar esta aba?"],
}

function renderText(text: string, isUser: boolean) {
  return text.split("\n").map((line, li) => (
    <span key={li} className="block">
      {line.split("**").map((part, i) =>
        i % 2 === 1 ? (
          <strong
            key={i}
            style={{
              color: isUser ? "#fff" : "#1B3A5C",
            }}
          >
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  ))
}

function MessageBubble({
  message,
}: {
  message: ChatMessage
}) {
  const isUser = message.role === "user"

  return (
    <div
      className={`flex ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm"
        style={{
          background: isUser ? "#1B3A5C" : "#FFFFFF",
          color: isUser ? "#FFFFFF" : "var(--text-primary)",
          border: isUser
            ? "none"
            : "1px solid var(--border)",
        }}
      >
        {renderText(message.text, isUser)}

        <div
          className="mt-2 text-[11px]"
          style={{ opacity: 0.6 }}
        >
          {message.time}
        </div>
      </div>
    </div>
  )
}

export function PCPChat() {
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)

  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      time: nowTime(),
      text:
        "Olá! Sou o PCP Chat.\n\n" +
        "Posso responder sobre OPs, faturamento, liberações e paradas de produção com base nos dados reais.",
    },
  ])

  const [position, setPosition] = useState(() => ({
    x: Math.max(window.innerWidth - 500, 24),
    y: Math.max(window.innerHeight - 760, 80),
  }))

  const dragRef = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
  })

  const bottomRef = useRef<HTMLDivElement>(null)

  const page = detectPage(location.pathname)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    })
  }, [messages])

  useEffect(() => {
    return () => {
      document.removeEventListener(
        "mousemove",
        onDrag
      )

      document.removeEventListener(
        "mouseup",
        stopDrag
      )
    }
  }, [])

  function clampPosition(x: number, y: number) {
    const padding = 8

    const maxX =
      window.innerWidth - 120

    const maxY =
      window.innerHeight - 80

    return {
      x: Math.min(
        Math.max(x, padding),
        maxX
      ),

      y: Math.min(
        Math.max(y, padding),
        maxY
      ),
    }
  }

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()

    dragRef.current.dragging = true
    dragRef.current.moved = false

    dragRef.current.startX = e.clientX
    dragRef.current.startY = e.clientY

    dragRef.current.offsetX =
      e.clientX - position.x

    dragRef.current.offsetY =
      e.clientY - position.y

    document.addEventListener(
      "mousemove",
      onDrag
    )

    document.addEventListener(
      "mouseup",
      stopDrag
    )
  }

  function onDrag(e: MouseEvent) {
    if (!dragRef.current.dragging) return

    const dx = Math.abs(
      e.clientX - dragRef.current.startX
    )

    const dy = Math.abs(
      e.clientY - dragRef.current.startY
    )

    if (dx > 4 || dy > 4) {
      dragRef.current.moved = true
    }

    const next = clampPosition(
      e.clientX -
        dragRef.current.offsetX,

      e.clientY -
        dragRef.current.offsetY
    )

    setPosition(next)
  }

  function stopDrag() {
    dragRef.current.dragging = false

    document.removeEventListener(
      "mousemove",
      onDrag
    )

    document.removeEventListener(
      "mouseup",
      stopDrag
    )
  }

  function handleClosedButtonClick() {
    if (dragRef.current.moved) {
      dragRef.current.moved = false
      return
    }

    setOpen(true)
    setMinimized(false)
  }

  function handleMinimizedButtonClick() {
    if (dragRef.current.moved) {
      dragRef.current.moved = false
      return
    }

    setMinimized(false)
  }

  async function handleSend(texto?: string) {
    const pergunta = (texto || input).trim()

    if (!pergunta || loading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: pergunta,
      time: nowTime(),
    }

    setMessages((prev) => [
      ...prev,
      userMsg,
    ])

    setInput("")
    setLoading(true)

    try {
      const historico = messages
        .filter((m) => m.id !== "welcome")
        .slice(-10)
        .map((m) => ({
          role: m.role,
          text: m.text,
        }))

      const res = await fetch(
        `${API_URL}/chat/mensagem`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            mensagem: pergunta,
            pagina: page,
            mes_ref: getMesAtual(),
            historico,
          }),
        }
      )

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({
            detail: `Erro ${res.status}`,
          }))

        throw new Error(
          err.detail ||
            `Erro ${res.status}`
        )
      }

      const data = await res.json()

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text:
            data.resposta ||
            "Sem resposta.",
          time: nowTime(),
        },
      ])
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : "Erro desconhecido"

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Não foi possível obter resposta: ${msg}`,
          time: nowTime(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const sugestoes =
    SUGESTOES[page] || SUGESTOES.geral

  return (
    <>
      {!open && (
        <button
          onMouseDown={startDrag}
          onClick={handleClosedButtonClick}
          className="fixed z-[999] flex cursor-move items-center gap-3 rounded-full px-4 py-3 shadow-2xl transition-all hover:scale-[1.02]"
          style={{
            left: position.x,
            top: position.y,
            background: "#1B3A5C",
            color: "#FFFFFF",
          }}
        >
          <MessageSquareText size={20} />

          <div className="hidden text-left sm:block">
            <div className="text-sm font-bold">
              PCP Chat
            </div>

            <div
              className="text-[11px]"
              style={{
                color:
                  "rgba(255,255,255,0.75)",
              }}
            >
              {PAGE_LABELS[page] ||
                "PCP"}{" "}
              · Online
            </div>
          </div>
        </button>
      )}

      {open && minimized && (
        <button
          onMouseDown={startDrag}
          onClick={
            handleMinimizedButtonClick
          }
          className="fixed z-[999] flex h-14 w-14 cursor-move items-center justify-center rounded-full shadow-2xl transition-all duration-200 hover:scale-[1.05]"
          style={{
            left: position.x,
            top: position.y,
            background: "#1B3A5C",
            color: "#FFFFFF",
            boxShadow:
              "0 10px 25px rgba(15,23,42,0.25)",
          }}
        >
          <MessageSquareText size={22} />
        </button>
      )}

      {open && !minimized && (
        <div
          className="fixed z-[999] flex h-[680px] w-[460px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
          style={{
            left: position.x,
            top: position.y,
            background: "#FFFFFF",
            borderColor:
              "var(--border)",
          }}
        >
          <div
            onMouseDown={startDrag}
            className="flex cursor-move items-center justify-between px-5 py-4"
            style={{
              background: "#1B3A5C",
              color: "#FFFFFF",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{
                  background:
                    "rgba(255,255,255,0.14)",
                }}
              >
                <MessageSquareText size={20} />
              </div>

              <div>
                <h2 className="text-sm font-bold">
                  PCP Chat
                </h2>

                <p
                  className="text-xs"
                  style={{
                    color:
                      "rgba(255,255,255,0.75)",
                  }}
                >
                  {PAGE_LABELS[page] ||
                    "PCP"}{" "}
                  · IA ativa
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onMouseDown={(e) =>
                  e.stopPropagation()
                }
                onClick={() =>
                  setMinimized(true)
                }
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{
                  background:
                    "rgba(255,255,255,0.12)",
                }}
              >
                <Minimize2 size={16} />
              </button>

              <button
                onMouseDown={(e) =>
                  e.stopPropagation()
                }
                onClick={() => {
                  setOpen(false)
                  setMinimized(false)
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{
                  background:
                    "rgba(255,255,255,0.12)",
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
            style={{
              background: "#F8FAFC",
            }}
          >
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
              />
            ))}

            {loading && (
              <div className="flex justify-start">
                <div
                  className="rounded-2xl px-4 py-3 text-sm"
                  style={{
                    background: "#FFFFFF",
                    border:
                      "1px solid var(--border)",
                    color:
                      "var(--text-secondary)",
                  }}
                >
                  <span className="animate-pulse">
                    Analisando dados com IA...
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {messages.length <= 1 &&
            !loading && (
              <div
                className="flex flex-wrap gap-2 px-4 pb-2"
                style={{
                  background: "#F8FAFC",
                }}
              >
                {sugestoes.map((s) => (
                  <button
                    key={s}
                    onClick={() =>
                      handleSend(s)
                    }
                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-100"
                    style={{
                      borderColor:
                        "var(--border)",
                      color:
                        "var(--text-secondary)",
                      background: "#fff",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

          <div
            className="border-t p-3"
            style={{
              borderColor:
                "var(--border)",
              background: "#FFFFFF",
            }}
          >
            <div
              className="flex items-center gap-2 rounded-2xl border p-2"
              style={{
                borderColor:
                  "var(--border)",
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: "#EEF2FF",
                  color: "#1B3A5C",
                }}
              >
                <Sparkles size={18} />
              </div>

              <input
                value={input}
                onChange={(e) =>
                  setInput(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    handleSend()
                }}
                placeholder="Ex: o que está faltando?"
                className="flex-1 bg-transparent text-sm outline-none"
                disabled={loading}
              />

              <button
                onClick={() =>
                  handleSend()
                }
                disabled={
                  !input.trim() ||
                  loading
                }
                className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-40"
                style={{
                  background: "#1B3A5C",
                  color: "#FFFFFF",
                }}
              >
                <Send size={18} />
              </button>
            </div>

            <div
              className="mt-2 flex items-center justify-center gap-1 text-[11px]"
              style={{
                color:
                  "var(--text-secondary)",
              }}
            >
              <ShieldCheck size={12} />
              Respostas baseadas nos dados reais
            </div>
          </div>
        </div>
      )}
    </>
  )
}
