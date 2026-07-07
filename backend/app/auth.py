"""
Dependência única de autenticação para a API.

Uso:
    from app.auth import usuario_logado, exigir_admin

    # Protege um router inteiro (recomendado):
    app.include_router(meu_router.router, dependencies=[Depends(usuario_logado)])

    # Ou protege um endpoint específico:
    @router.get("/algo")
    async def algo(perfil: dict = Depends(usuario_logado)):
        ...
"""

from typing import Any

from fastapi import Depends, HTTPException, Header

from app.database import supabase


def _get_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Token não informado.")

    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Token inválido.")

    token = authorization[len(prefix):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token inválido.")

    return token


def usuario_logado(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Valida o token Bearer contra o Supabase Auth e retorna o perfil
    correspondente em usuarios_app. Levanta 401/403 se algo não bater.
    """
    token = _get_bearer_token(authorization)

    try:
        user_resp = supabase.auth.get_user(token)
        user = user_resp.user
    except Exception:
        raise HTTPException(status_code=401, detail="Sessão inválida.")

    if not user:
        raise HTTPException(status_code=401, detail="Usuário não autenticado.")

    res = (
        supabase.table("usuarios_app")
        .select("*")
        .eq("auth_user_id", user.id)
        .limit(1)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=403, detail="Usuário sem perfil configurado.")

    perfil = res.data[0]

    if not perfil.get("ativo", True):
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return perfil


def exigir_admin(perfil: dict[str, Any] = Depends(usuario_logado)) -> dict[str, Any]:
    """Igual a usuario_logado, mas além disso exige perfil admin
    (ou permissão explícita de 'configuracoes')."""
    permissoes = perfil.get("permissoes") or []
    is_admin = perfil.get("perfil") == "admin" or "configuracoes" in permissoes

    if not is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")

    return perfil
