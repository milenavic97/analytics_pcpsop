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
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*"

  let senha = ""

  for (let i = 0; i < tamanho; i++) {
    senha += chars.charAt(
      Math.floor(Math.random() * chars.length)
    )
  }

  return senha
}

async function getToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  return session?.access_token || ""
}

export default function ConfiguracoesPage() {
  const [usuarios, setUsuarios] = useState<UsuarioApp[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [erro, setErro] = useState("")
  const [sucesso, setSucesso] = useState("")

  const [mostrarSenha, setMostrarSenha] = useState(false)

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

  const permissoesDisponiveis = useMemo(
    () => APP_PAGES,
    []
  )

  async function apiFetch(
    path: string,
    options: RequestInit = {}
  ) {
    const token = await getToken()

    const response = await fetch(
      `${API_URL}${path}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data?.detail || "Erro na requisição."
      )
    }

    return data
  }

  async function carregarUsuarios() {
    try {
      setLoading(true)

      const data = await apiFetch("/usuarios")

      setUsuarios(data || [])
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : "Erro carregando usuários."
      )
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
          ? prev.permissoes.filter(
              (p) => p !== permissao
            )
          : [...prev.permissoes, permissao],
      }
    })
  }

  async function criarUsuario() {
    try {
      setErro("")
      setSucesso("")
      setSaving(true)

      await apiFetch("/usuarios", {
        method: "POST",
        body: JSON.stringify(form),
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
      setErro(
        err instanceof Error
          ? err.message
          : "Erro criando usuário."
      )
    } finally {
      setSaving(false)
    }
  }

  async function salvarUsuario(usuario: UsuarioApp) {
    try {
      setErro("")
      setSucesso("")
      setSaving(true)

      await apiFetch(`/usuarios/${usuario.id}`, {
        method: "PUT",
        body: JSON.stringify({
          nome: usuario.nome,
          usuario: usuario.usuario,
          email: usuario.email,
          perfil: usuario.perfil,
          ativo: usuario.ativo,
          permissoes: usuario.permissoes,
        }),
      })

      setSucesso("Usuário atualizado.")
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : "Erro salvando usuário."
      )
    } finally {
      setSaving(false)
    }
  }

  async function alterarSenha(usuario: UsuarioApp) {
    try {
      setErro("")
      setSucesso("")

      await apiFetch(
        `/usuarios/${usuario.id}/senha`,
        {
          method: "PUT",
          body: JSON.stringify({
            senha: novaSenha[usuario.id],
          }),
        }
      )

      setSucesso(
        `Senha de ${usuario.nome} alterada.`
      )

      setNovaSenha((prev) => ({
        ...prev,
        [usuario.id]: "",
      }))
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : "Erro alterando senha."
      )
    }
  }

  async function excluirUsuario(usuario: UsuarioApp) {
    const confirmar = confirm(
      `Excluir usuário ${usuario.nome}?`
    )

    if (!confirmar) return

    try {
      await apiFetch(`/usuarios/${usuario.id}`, {
        method: "DELETE",
      })

      await carregarUsuarios()

      setSucesso("Usuário removido.")
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : "Erro excluindo usuário."
      )
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-6">
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
            Controle de usuários e permissões.
          </p>
        </div>
      </div>

      {erro && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      {sucesso && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 size={16} />
          {sucesso}
        </div>
      )}

      <div
        className="mb-6 rounded-2xl border p-5"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="mb-5 flex items-center gap-2">
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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <input
            placeholder="Nome"
            value={form.nome}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                nome: e.target.value,
              }))
            }
            className="rounded-xl border px-3 py-2 text-sm"
          />

          <input
            placeholder="Usuário"
            value={form.usuario}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                usuario: e.target.value,
              }))
            }
            className="rounded-xl border px-3 py-2 text-sm"
          />

          <input
            placeholder="Email"
            value={form.email}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                email: e.target.value,
              }))
            }
            className="rounded-xl border px-3 py-2 text-sm"
          />

          <select
            value={form.perfil}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                perfil: e.target.value,
              }))
            }
            className="rounded-xl border px-3 py-2 text-sm"
          >
            <option value="usuario">
              Usuário
            </option>

            <option value="admin">
              Admin
            </option>
          </select>
        </div>

        <div className="mt-4 flex flex-col gap-3 xl:flex-row">
          <div className="relative flex-1">
            <input
              type={
                mostrarSenha ? "text" : "password"
              }
              placeholder="Senha"
              value={form.senha}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  senha: e.target.value,
                }))
              }
              className="w-full rounded-xl border px-3 py-2 pr-10 text-sm"
            />

            <button
              type="button"
              onClick={() =>
                setMostrarSenha((prev) => !prev)
              }
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              {mostrarSenha ? (
                <EyeOff size={16} />
              ) : (
                <Eye size={16} />
              )}
            </button>
          </div>

          <button
            onClick={() =>
              setForm((prev) => ({
                ...prev,
                senha: gerarSenhaForte(),
              }))
            }
            className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            <KeyRound size={15} />
            Gerar senha forte
          </button>

          <button
            onClick={() =>
              navigator.clipboard.writeText(
                form.senha
              )
            }
            className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
          >
            <Copy size={15} />
            Copiar
          </button>
        </div>

        <div className="mt-5">
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
                form.permissoes.includes(page.id)

              return (
                <label
                  key={page.id}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      togglePermissao(page.id)
                    }
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
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{
              background: "var(--bg-sidebar)",
            }}
          >
            {saving ? (
              <Loader2
                size={15}
                className="animate-spin"
              />
            ) : (
              <Save size={15} />
            )}

            Criar usuário
          </button>
        </div>
      </div>

      <div
        className="rounded-2xl border"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-secondary)",
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <UserCog size={18} />

            <h2
              className="text-lg font-bold"
              style={{
                color: "var(--text-primary)",
              }}
            >
              Usuários
            </h2>
          </div>

          <button
            onClick={carregarUsuarios}
            className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"
          >
            <RefreshCw size={15} />
            Atualizar
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm">
            <Loader2
              size={16}
              className="animate-spin"
            />
            Carregando usuários...
          </div>
        ) : (
          <div className="divide-y">
            {usuarios.map((usuario) => (
              <div
                key={usuario.id}
                className="p-5"
              >
                <div className="grid gap-4 xl:grid-cols-4">
                  <input
                    value={usuario.nome}
                    onChange={(e) =>
                      setUsuarios((prev) =>
                        prev.map((u) =>
                          u.id === usuario.id
                            ? {
                                ...u,
                                nome:
                                  e.target.value,
                              }
                            : u
                        )
                      )
                    }
                    className="rounded-xl border px-3 py-2 text-sm"
                  />

                  <input
                    value={usuario.usuario}
                    onChange={(e) =>
                      setUsuarios((prev) =>
                        prev.map((u) =>
                          u.id === usuario.id
                            ? {
                                ...u,
                                usuario:
                                  e.target.value,
                              }
                            : u
                        )
                      )
                    }
                    className="rounded-xl border px-3 py-2 text-sm"
                  />

                  <input
                    value={usuario.email}
                    onChange={(e) =>
                      setUsuarios((prev) =>
                        prev.map((u) =>
                          u.id === usuario.id
                            ? {
                                ...u,
                                email:
                                  e.target.value,
                              }
                            : u
                        )
                      )
                    }
                    className="rounded-xl border px-3 py-2 text-sm"
                  />

                  <select
                    value={usuario.perfil}
                    onChange={(e) =>
                      setUsuarios((prev) =>
                        prev.map((u) =>
                          u.id === usuario.id
                            ? {
                                ...u,
                                perfil:
                                  e.target.value,
                              }
                            : u
                        )
                      )
                    }
                    className="rounded-xl border px-3 py-2 text-sm"
                  >
                    <option value="usuario">
                      Usuário
                    </option>

                    <option value="admin">
                      Admin
                    </option>
                  </select>
                </div>

                <div className="mt-4">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {permissoesDisponiveis.map(
                      (page) => {
                        const checked =
                          usuario.permissoes?.includes(
                            page.id
                          )

                        return (
                          <label
                            key={page.id}
                            className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setUsuarios(
                                  (prev) =>
                                    prev.map((u) => {
                                      if (
                                        u.id !==
                                        usuario.id
                                      )
                                        return u

                                      const existe =
                                        u.permissoes.includes(
                                          page.id
                                        )

                                      return {
                                        ...u,
                                        permissoes:
                                          existe
                                            ? u.permissoes.filter(
                                                (
                                                  p
                                                ) =>
                                                  p !==
                                                  page.id
                                              )
                                            : [
                                                ...u.permissoes,
                                                page.id,
                                              ],
                                      }
                                    })
                                )
                              }}
                            />

                            {page.label}
                          </label>
                        )
                      }
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-1 gap-2">
                    <input
                      type="password"
                      placeholder="Nova senha"
                      value={
                        novaSenha[usuario.id] || ""
                      }
                      onChange={(e) =>
                        setNovaSenha((prev) => ({
                          ...prev,
                          [usuario.id]:
                            e.target.value,
                        }))
                      }
                      className="flex-1 rounded-xl border px-3 py-2 text-sm"
                    />

                    <button
                      onClick={() =>
                        setNovaSenha((prev) => ({
                          ...prev,
                          [usuario.id]:
                            gerarSenhaForte(),
                        }))
                      }
                      className="rounded-xl border px-3 py-2"
                    >
                      <KeyRound size={15} />
                    </button>

                    <button
                      onClick={() =>
                        alterarSenha(usuario)
                      }
                      className="rounded-xl border px-3 py-2 text-sm font-semibold"
                    >
                      Alterar senha
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        salvarUsuario(usuario)
                      }
                      className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold"
                    >
                      <Save size={15} />
                      Salvar
                    </button>

                    <button
                      onClick={() =>
                        excluirUsuario(usuario)
                      }
                      className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600"
                    >
                      <Trash2 size={15} />
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
