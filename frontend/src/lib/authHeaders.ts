import { supabase } from "./supabase"

// Helper compartilhado para anexar o token da sessão atual em chamadas
// que fazem fetch() direto para a API (fora do services/api.ts).
// O backend agora exige Authorization: Bearer <token> em quase toda rota.
export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
