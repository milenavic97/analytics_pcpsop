import httpx
from supabase import create_client, Client
from app.config import settings


def _desativar_http2_no_postgrest(client: Client) -> None:
    """
    Força o cliente do postgrest (usado por toda chamada supabase.table(...))
    a falar HTTP/1.1 em vez de HTTP/2.

    Causa raiz de uma instabilidade real vista em produção o dia inteiro:
    a biblioteca postgrest-py cria seu cliente HTTP interno com http2=True
    fixo (não é algo configurável via ClientOptions do supabase-py). A
    combinação de HTTP/2 + múltiplas chamadas concorrentes (a thread de
    aquecimento em background rodando ao mesmo tempo que requisições de
    vários usuários) expõe um bug de concorrência conhecido do httpx/httpcore
    nessa versão: a conexão às vezes é derrubada no meio de uma requisição
    (RemoteProtocolError / WriteError: Connection reset by peer), inclusive
    dentro da checagem de login (usuario_logado), causando erros 500
    aleatórios e dados parciais/zerados quando a exceção é engolida por um
    try/except em algum ponto do código.

    HTTP/1.1 com pool de conexões maior é mais tolerante a esse tipo de uso
    concorrente e evita esse bug específico. Troca é segura: o cliente do
    postgrest é só uma sub-classe do httpx.Client padrão, sem métodos
    próprios além dos herdados.
    """
    sessao_antiga = client.postgrest.session

    client.postgrest.session = httpx.Client(
        base_url=sessao_antiga.base_url,
        headers=sessao_antiga.headers,
        timeout=sessao_antiga.timeout,
        http2=False,
        limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
    )

    try:
        sessao_antiga.close()
    except Exception:
        pass


def get_supabase() -> Client:
    if not settings.supabase_url or not settings.supabase_service_key:
        raise Exception("Supabase não configurado. Verifique .env")

    client = create_client(
        settings.supabase_url,
        settings.supabase_service_key
    )

    _desativar_http2_no_postgrest(client)

    return client


supabase: Client = get_supabase()