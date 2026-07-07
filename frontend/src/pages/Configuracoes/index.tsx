import { useEffect, useMemo, useState } from "react"

import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserCog,
} from "lucide-react"

import { supabase } from "@/lib/supabase"
import { APP_PAGES } from "@/config/pages"

const API_URL = import.meta.env.VITE_API_URL

type UsuarioApp = {
  id: string
  auth_user_id: string
  nome: string
  usuario: string
  email: string
  perfil: string
  ativo: boolean
  permissoes: string[]
}

type FormNovoUsuario = {
  nome: string
  usuario: string
  email: string
  senha: string
  perfil: string
  ativo: boolean
  permissoes: string[]
}

function gerarSenhaForte(tamanho = 14) {
  const maiusculas = "ABCDEFGHJKLMNPQRSTUVWXYZ"
  const minusculas = "abcdefghijkmnopqrstuvwxyz"
  const numeros = "23456789"
  const especiais = "!@#$%&*"
  const todos = maiusculas + minusculas + numeros + especiais

  const obrigatorios = [
    maiusculas[Math.floor(Math.random() * maiusculas.length)],
    minusculas[Math.floor(Math.random() * minusculas.length)],
    numeros[Math.floor(Math.random() * numeros.length)],
    especiais[Math.floor(Math.random() * especiais.length)],
  ]

  const restante = Array.from(
    { length: Math.max(tamanho - obrigatorios.length, 0) },
    () => todos[Math.floor(Math.random() * todos.length)]
  )

  return [...obrigatorios, ...restante]
    .sort(() => Math.random() - 0.5)
    .join("")
}

async function getToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.access_token || ""
}

function normalizarUsuario(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

function normalizarEmail(value: string) {
  return value.trim().toLowerCase()
}

function FieldLabel({ children }: { children: string }) {
  return (
    <label
      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </label>
  )
}

function InputBase(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition",
        "focus:ring-2 focus:ring-[#1B3A5C]/15",
        props.className || "",
      ].join(" ")}
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        ...(props.style || {}),
      }}
    />
  )
}

function SelectBase(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition",
        "focus:ring-2 focus:ring-[#1B3A5C]/15",
        props.className || "",
      ].join(" ")}
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
        ...(props.style || {}),
      }}
    />
  )
}

function ButtonSecundario({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: "button" | "submit"
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      {children}
    </button>
  )
}

export default function ConfiguracoesPage() {
  const [usuarios, setUsuarios] = useState<UsuarioApp[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [erro, setErro] = useState("")
  const [sucesso, setSucesso] = useState("")

  const [mostrarSenhaNovo, setMostrarSenhaNovo] = useState(false)
  const [mostrarSenhaUsuarios, setMostrarSenhaUsuarios] = useState<Record<string, boolean>>({})

  const [novaSenha, setNovaSenha] = useState<Record<string, string>>({})

  const [form, setForm] = useState<FormNovoUsuario>({
    nome: "",
    usuario: "",
    email: "",
    senha: "",
    perfil: "usuario",
    ativo: true,
    permissoes: ["overview"],
  })

  const permissoesDisponiveis = useMemo(() => APP_PAGES, [])

  async function apiFetch(path: string, options: RequestInit = {}) {
    const token = await getToken()

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    })

    const contentType = response.headers.get("content-type") || ""
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text()

    if (!response.ok) {
      const detail =
        typeof data === "object" && data && "detail" in data
          ? String((data as { detail?: unknown }).detail)
          : "Erro na requisição."

      throw new Error(detail)
    }

    return data
  }

  async function carregarUsuarios() {
    try {
      setLoading(true)
      setErro("")

      const data = await apiFetch("/usuarios")

      setUsuarios(Array.isArray(data) ? data : [])
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro carregando usuários.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarUsuarios()
  }, [])

  function togglePermissao(permissao: string) {
    setForm((prev) => {
      const existe = prev.permissoes.includes(permissao)

      return {
        ...prev,
        permissoes: existe
          ? prev.permissoes.filter((p) => p !== permissao)
          : [...prev.permissoes, permissao],
      }
    })
  }

  function togglePermissaoUsuario(usuarioId: string, permissao: string) {
    setUsuarios((prev) =>
      prev.map((u) => {
        if (u.id !== usuarioId) return u

        const permissoesAtuais = u.permissoes || []
        const existe = permissoesAtuais.includes(permissao)

        return {
          ...u,
          permissoes: existe
            ? permissoesAtuais.filter((p) => p !== permissao)
            : [...permissoesAtuais, permissao],
        }
      })
    )
  }

  async function criarUsuario() {
    try {
      setErro("")
      setSucesso("")
      setSaving(true)

      const payload = {
        ...form,
        usuario: normalizarUsuario(form.usuario),
        email: normalizarEmail(form.email),
        permissoes:
          form.perfil === "admin"
            ? permissoesDisponiveis.map((page) => page.id)
            : form.permissoes,
      }

      if (!payload.nome.trim()) {
        throw new Error("Informe o nome do usuário.")
      }

      if (!payload.usuario.trim()) {
        throw new Error("Informe o usuário de login.")
      }

      if (!payload.email.trim()) {
        throw new Error("Informe o e-mail.")
      }

      if (!payload.senha || payload.senha.length < 6) {
        throw new Error("Informe uma senha com pelo menos 6 caracteres.")
      }

      await apiFetch("/usuarios", {
        method: "POST",
        body: JSON.stringify(payload),
      })

      setSucesso("Usuário criado com sucesso.")

      setForm({
        nome: "",
        usuario: "",
        email: "",
        senha: "",
        perfil: "usuario",
        ativo: true,
        permissoes: ["overview"],
      })

      await carregarUsuarios()
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro criando usuário.")
    } finally {
      setSaving(false)
    }
  }

  async function salvarUsuario(usuario: UsuarioApp) {
    try {
      setErro("")
      setSucesso("")
      setSaving(true)

      const permissoes =
        usuario.perfil === "admin"
          ? permissoesDisponiveis.map((page) => page.id)
          : usuario.permissoes || []

      await apiFetch(`/usuarios/${usuario.id}`, {
        method: "PUT",
        body: JSON.stringify({
          nome: usuario.nome,
          usuario: normalizarUsuario(usuario.usuario),
          email: normalizarEmail(usuario.email),
          perfil: usuario.perfil,
          ativo: usuario.ativo,
          permissoes,
        }),
      })

      setSucesso("Usuário atualizado.")
      await carregarUsuarios()
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro salvando usuário.")
    } finally {
      setSaving(false)
    }
  }

  async function alterarSenha(usuario: UsuarioApp) {
    try {
      setErro("")
      setSucesso("")

      const senha = novaSenha[usuario.id] || ""

      if (!senha || senha.length < 6) {
        throw new Error("Informe uma nova senha com pelo menos 6 caracteres.")
      }

      await apiFetch(`/usuarios/${usuario.id}/senha`, {
        method: "PUT",
        body: JSON.stringify({
          senha,
        }),
      })

      setSucesso(`Senha de ${usuario.nome} alterada.`)

      setNovaSenha((prev) => ({
        ...prev,
        [usuario.id]: "",
      }))
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro alterando senha.")
    }
  }

  async function excluirUsuario(usuario: UsuarioApp) {
    const confirmar = confirm(`Excluir usuário ${usuario.nome}?`)

    if (!confirmar) return

    try {
      setErro("")
      setSucesso("")
      setSaving(true)

      await apiFetch(`/usuarios/${usuario.id}`, {
        method: "DELETE",
      })

      await carregarUsuarios()

      setSucesso("Usuário removido.")
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro excluindo usuário.")
    } finally {
      setSaving(false)
    }
  }

  function atualizarUsuarioLocal(usuarioId: string, campo: keyof UsuarioApp, valor: unknown) {
    setUsuarios((prev) =>
      prev.map((u) =>
        u.id === usuarioId
          ? {
              ...u,
              [campo]: valor,
            }
          : u
      )
    )
  }

  return (
    <div className="w-full px-4 py-6 md:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{
            background: "var(--bg-sidebar)",
            color: "#fff",
          }}
        >
          <ShieldCheck size={20} />
        </div>

        <div>
          <h1
            className="text-2xl font-bold"
            style={{
              color: "var(--text-primary)",
            }}
          >
            Configurações
          </h1>

          <p
            className="text-sm"
            style={{
              color: "var(--text-secondary)",
            }}
          >
            Controle de usuários, senhas e permissões de acesso.
          </p>
        </div>
      </div>

      {erro && (
        <div className="mb-4 flex max-w-[1280px] items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      {sucesso && (
        <div className="mb-4 flex max-w-[1280px] items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          {sucesso}
        </div>
      )}

      <div
        className="mb-6 max-w-[1280px] rounded-2xl border p-5"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Plus size={18} />

              <h2
                className="text-lg font-bold"
                style={{
                  color: "var(--text-primary)",
                }}
              >
                Novo usuário
              </h2>
            </div>

            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Crie o acesso inicial e escolha quais telas esse usuário poderá visualizar.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <FieldLabel>Nome</FieldLabel>
            <InputBase
              placeholder="Ex.: João Silva"
              value={form.nome}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  nome: e.target.value,
                }))
              }
            />
          </div>

          <div>
            <FieldLabel>Usuário</FieldLabel>
            <InputBase
              placeholder="Ex.: joaopcp"
              value={form.usuario}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  usuario: normalizarUsuario(e.target.value),
                }))
              }
            />
          </div>

          <div>
            <FieldLabel>E-mail</FieldLabel>
            <InputBase
              placeholder="Ex.: joao@empresa.com"
              value={form.email}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  email: normalizarEmail(e.target.value),
                }))
              }
            />
          </div>

          <div>
            <FieldLabel>Perfil</FieldLabel>
            <SelectBase
              value={form.perfil}
              onChange={(e) => {
                const perfil = e.target.value

                setForm((prev) => ({
                  ...prev,
                  perfil,
                  permissoes:
                    perfil === "admin"
                      ? permissoesDisponiveis.map((page) => page.id)
                      : prev.permissoes,
                }))
              }}
            >
              <option value="usuario">Usuário</option>
              <option value="admin">Admin</option>
            </SelectBase>
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel>Senha inicial</FieldLabel>

          <div className="flex flex-col gap-3 xl:flex-row">
            <div className="relative flex-1">
              <InputBase
                type={mostrarSenhaNovo ? "text" : "password"}
                placeholder="Digite ou gere uma senha forte"
                value={form.senha}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    senha: e.target.value,
                  }))
                }
                className="pr-10"
              />

              <button
                type="button"
                onClick={() => setMostrarSenhaNovo((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-secondary)" }}
              >
                {mostrarSenhaNovo ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <ButtonSecundario
              onClick={() => {
                setForm((prev) => ({
                  ...prev,
                  senha: gerarSenhaForte(),
                }))
                setMostrarSenhaNovo(true)
              }}
            >
              <KeyRound size={15} />
              Gerar senha forte
            </ButtonSecundario>

            <ButtonSecundario
              disabled={!form.senha}
              onClick={() => navigator.clipboard.writeText(form.senha)}
            >
              <Copy size={15} />
              Copiar
            </ButtonSecundario>
          </div>
        </div>

        <div className="mt-5">
          <p
            className="mb-2 text-xs font-semibold uppercase"
            style={{
              color: "var(--text-secondary)",
            }}
          >
            Permissões de acesso
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {permissoesDisponiveis.map((page) => {
              const checked = form.perfil === "admin" || form.permissoes.includes(page.id)

              return (
                <label
                  key={page.id}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition"
                  style={{
                    borderColor: checked ? "#93C5FD" : "var(--border)",
                    background: checked ? "#EFF6FF" : "var(--bg-primary)",
                    color: checked ? "#1D4ED8" : "var(--text-primary)",
                    opacity: form.perfil === "admin" ? 0.75 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={form.perfil === "admin"}
                    onChange={() => togglePermissao(page.id)}
                  />

                  {page.label}
                </label>
              )
            })}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={criarUsuario}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              background: "var(--bg-sidebar)",
            }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}

            Criar usuário
          </button>
        </div>
      </div>

      <div
        className="max-w-[1280px] rounded-2xl border"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-secondary)",
        }}
      >
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <div className="flex items-center gap-2">
              <UserCog size={18} />

              <h2
                className="text-lg font-bold"
                style={{
                  color: "var(--text-primary)",
                }}
              >
                Usuários cadastrados
              </h2>
            </div>

            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Edite dados, permissões e senha dos usuários ativos na ferramenta.
            </p>
          </div>

          <ButtonSecundario onClick={carregarUsuarios}>
            <RefreshCw size={15} />
            Atualizar
          </ButtonSecundario>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm" style={{ color: "var(--text-secondary)" }}>
            <Loader2 size={16} className="animate-spin" />
            Carregando usuários...
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {usuarios.map((usuario) => {
              const senhaUsuario = novaSenha[usuario.id] || ""
              const mostrarSenhaUsuario = !!mostrarSenhaUsuarios[usuario.id]

              return (
                <div key={usuario.id} className="p-5">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <FieldLabel>Nome</FieldLabel>
                      <InputBase
                        value={usuario.nome || ""}
                        onChange={(e) => atualizarUsuarioLocal(usuario.id, "nome", e.target.value)}
                      />
                    </div>

                    <div>
                      <FieldLabel>Usuário</FieldLabel>
                      <InputBase
                        value={usuario.usuario || ""}
                        onChange={(e) =>
                          atualizarUsuarioLocal(usuario.id, "usuario", normalizarUsuario(e.target.value))
                        }
                      />
                    </div>

                    <div>
                      <FieldLabel>E-mail</FieldLabel>
                      <InputBase
                        value={usuario.email || ""}
                        onChange={(e) =>
                          atualizarUsuarioLocal(usuario.id, "email", normalizarEmail(e.target.value))
                        }
                      />
                    </div>

                    <div>
                      <FieldLabel>Perfil</FieldLabel>
                      <SelectBase
                        value={usuario.perfil || "usuario"}
                        onChange={(e) => {
                          const perfil = e.target.value
                          atualizarUsuarioLocal(usuario.id, "perfil", perfil)

                          if (perfil === "admin") {
                            atualizarUsuarioLocal(
                              usuario.id,
                              "permissoes",
                              permissoesDisponiveis.map((page) => page.id)
                            )
                          }
                        }}
                      >
                        <option value="usuario">Usuário</option>
                        <option value="admin">Admin</option>
                      </SelectBase>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p
                      className="mb-2 text-xs font-semibold uppercase"
                      style={{
                        color: "var(--text-secondary)",
                      }}
                    >
                      Permissões
                    </p>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {permissoesDisponiveis.map((page) => {
                        const checked =
                          usuario.perfil === "admin" || usuario.permissoes?.includes(page.id)

                        return (
                          <label
                            key={page.id}
                            className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition"
                            style={{
                              borderColor: checked ? "#93C5FD" : "var(--border)",
                              background: checked ? "#EFF6FF" : "var(--bg-primary)",
                              color: checked ? "#1D4ED8" : "var(--text-primary)",
                              opacity: usuario.perfil === "admin" ? 0.75 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={usuario.perfil === "admin"}
                              onChange={() => togglePermissaoUsuario(usuario.id, page.id)}
                            />

                            {page.label}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="mt-4">
                    <FieldLabel>Alterar senha</FieldLabel>

                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-1 gap-2">
                        <div className="relative flex-1">
                          <InputBase
                            type={mostrarSenhaUsuario ? "text" : "password"}
                            placeholder="Nova senha"
                            value={senhaUsuario}
                            onChange={(e) =>
                              setNovaSenha((prev) => ({
                                ...prev,
                                [usuario.id]: e.target.value,
                              }))
                            }
                            className="pr-10"
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setMostrarSenhaUsuarios((prev) => ({
                                ...prev,
                                [usuario.id]: !prev[usuario.id],
                              }))
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {mostrarSenhaUsuario ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>

                        <ButtonSecundario
                          onClick={() => {
                            setNovaSenha((prev) => ({
                              ...prev,
                              [usuario.id]: gerarSenhaForte(),
                            }))
                            setMostrarSenhaUsuarios((prev) => ({
                              ...prev,
                              [usuario.id]: true,
                            }))
                          }}
                        >
                          <KeyRound size={15} />
                          Gerar
                        </ButtonSecundario>

                        <ButtonSecundario
                          disabled={!senhaUsuario}
                          onClick={() => navigator.clipboard.writeText(senhaUsuario)}
                        >
                          <Copy size={15} />
                          Copiar
                        </ButtonSecundario>

                        <ButtonSecundario
                          disabled={!senhaUsuario}
                          onClick={() => alterarSenha(usuario)}
                        >
                          Alterar senha
                        </ButtonSecundario>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => salvarUsuario(usuario)}
                          disabled={saving}
                          className="flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                          style={{
                            borderColor: "var(--border)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                          }}
                        >
                          <Save size={15} />
                          Salvar
                        </button>

                        <button
                          onClick={() => excluirUsuario(usuario)}
                          disabled={saving}
                          className="flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 size={15} />
                          Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
