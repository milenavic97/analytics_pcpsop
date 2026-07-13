import { supabase } from "./supabase"

/**
 * Wrapper fino em cima de supabase.auth.mfa.* (API nativa do Supabase Auth
 * para autenticação em 2 fatores via TOTP -- Google Authenticator, Authy,
 * 1Password, etc.). Não existe rota própria no backend para cadastro/
 * verificação: tudo aqui fala direto com o Supabase Auth, exatamente como
 * o login por senha já faz em lib/supabase.ts.
 */

export type FatorMfa = {
  id: string
  friendlyName: string | null
  factorType: string
  status: "verified" | "unverified"
}

export async function listarFatores(): Promise<FatorMfa[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error

  return (data?.all || []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    factorType: f.factor_type,
    status: f.status,
  }))
}

export async function temFatorVerificado(): Promise<boolean> {
  const fatores = await listarFatores()
  return fatores.some((f) => f.status === "verified")
}

/** Nível de segurança da sessão atual ("aal1" = só senha, "aal2" = senha + segundo fator confirmado neste login). */
export async function nivelSeguranca() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return {
    atual: data?.currentLevel ?? "aal1",
    proximo: data?.nextLevel ?? "aal1",
  }
}

/** Passo 1 do cadastro: gera o QR code e o segredo para digitação manual. */
export async function iniciarCadastroTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Analytics PCP - ${new Date().toISOString().slice(0, 10)}`,
  })

  if (error) throw error

  return {
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code, // string SVG pronta, vinda do Supabase -- não é conteúdo digitado pelo usuário
    segredoManual: data.totp.secret,
    uri: data.totp.uri,
  }
}

/** Passo 2 do cadastro: confirma que a pessoa configurou certo o app autenticador. */
export async function confirmarCadastroTotp(factorId: string, codigo: string) {
  const challenge = await supabase.auth.mfa.challenge({ factorId })
  if (challenge.error) throw challenge.error

  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: codigo.trim(),
  })

  if (verify.error) throw verify.error
  return verify.data
}

/** Usado na tela de login, depois da senha, quando a conta já tem um fator verificado. */
export async function verificarCodigoLogin(factorId: string, codigo: string) {
  const { data, error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: codigo.trim(),
  })

  if (error) throw error
  return data
}

/** Remove o fator atual (para recadastrar, ex.: perdeu o celular). */
export async function removerFator(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
}