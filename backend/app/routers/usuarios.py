from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Any
from app.database import supabase
from app.config import settings
from app.auth import (
    usuario_logado as _usuario_logado,
    usuario_logado_permitir_pendente_mfa as _usuario_logado_pendente_mfa,
)

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


class ResolverLoginBody(BaseModel):
    usuario: str = Field(..., min_length=1)


# Permissões/telas disponíveis na ferramenta.
# O front também terá uma lista igual em pages.ts.
PERMISSOES_VALIDAS = {
    "overview",
    "liberacao-executiva",
    "producao",
    "faturamento",
    "desvios",
    "ordens",
    "mps",
    "analise-mrp",
    "calendario-paradas",
    "dados",
    "configuracoes",
}


class UsuarioCreate(BaseModel):
    nome: str = Field(..., min_length=2)
    usuario: str = Field(..., min_length=3)
    email: EmailStr
    senha: str = Field(..., min_length=6)
    perfil: str = "usuario"
    ativo: bool = True
    permissoes: list[str] = []


class UsuarioUpdate(BaseModel):
    nome: Optional[str] = None
    usuario: Optional[str] = None
    email: Optional[EmailStr] = None
    perfil: Optional[str] = None
    ativo: Optional[bool] = None
    permissoes: Optional[list[str]] = None


class SenhaUpdate(BaseModel):
    senha: str = Field(..., min_length=6)


def _validar_permissoes(permissoes: list[str]) -> list[str]:
    limpas = []
    for p in permissoes or []:
        p_norm = str(p or "").strip()
        if not p_norm:
            continue
        if p_norm not in PERMISSOES_VALIDAS:
            raise HTTPException(status_code=422, detail=f"Permissão inválida: {p_norm}")
        if p_norm not in limpas:
            limpas.append(p_norm)
    return limpas


def _exigir_admin(authorization: str | None) -> dict[str, Any]:
    perfil = _usuario_logado(authorization)

    permissoes = perfil.get("permissoes") or []
    is_admin = perfil.get("perfil") == "admin" or "configuracoes" in permissoes

    if not is_admin:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores.")

    return perfil


@router.post("/resolver-login")
def resolver_login(body: ResolverLoginBody):
    """
    Traduz um "usuário" (apelido de login) para o e-mail cadastrado, para
    a tela de login poder aceitar tanto e-mail quanto apelido sem precisar
    de nenhuma lista de e-mail fixa no código do frontend (o bundle do
    frontend é público -- ninguém deveria conseguir ler e-mail de pessoa
    ali dentro).

    Rota pública de propósito (roda antes do login existir). Devolve
    sempre 200 com "email": null quando não encontra nada, em vez de um
    404 -- assim dá pra distinguir um pouco menos "esse usuário existe"
    de "esse usuário não existe" olhando só o status HTTP. Não é
    proteção total contra enumeração de usuário (uma característica
    inerente a qualquer login por apelido), mas evita o problema mais
    grave, que era o vazamento de e-mail real no código-fonte público.
    """
    usuario_norm = body.usuario.strip().lower()

    if "@" in usuario_norm:
        # Já parece um e-mail -- não precisa resolver nada, e não faz
        # sentido consultar a tabela de apelidos por um e-mail.
        return {"email": usuario_norm}

    try:
        res = (
            supabase.table("usuarios_app")
            .select("email, ativo")
            .eq("usuario", usuario_norm)
            .limit(1)
            .execute()
        )
    except Exception:
        return {"email": None}

    linha = (res.data or [None])[0]

    if not linha or not linha.get("ativo", True):
        return {"email": None}

    return {"email": linha.get("email")}


@router.get("/me")
def get_me(authorization: str | None = Header(default=None)):
    perfil = _usuario_logado_pendente_mfa(authorization)

    return {
        "id": perfil.get("id"),
        "auth_user_id": perfil.get("auth_user_id"),
        "nome": perfil.get("nome"),
        "usuario": perfil.get("usuario"),
        "email": perfil.get("email"),
        "perfil": perfil.get("perfil"),
        "ativo": perfil.get("ativo"),
        "permissoes": perfil.get("permissoes") or [],
        "mfa_ativo": bool(perfil.get("_mfa_verificado")),
        # Diz ao frontend (MfaGate) se o cadastro do segundo fator está
        # sendo exigido agora (settings.mfa_obrigatorio, controlado por
        # variável de ambiente, sem precisar de deploy). Vem sempre nessa
        # rota porque ela usa usuario_logado_permitir_pendente_mfa -- ou
        # seja, responde mesmo pra quem ainda não cadastrou nada.
        "mfa_obrigatorio": settings.mfa_obrigatorio,
    }


@router.get("")
def listar_usuarios(authorization: str | None = Header(default=None)):
    _exigir_admin(authorization)

    res = (
        supabase.table("usuarios_app")
        .select("id, auth_user_id, nome, usuario, email, perfil, ativo, permissoes, created_at, updated_at")
        .order("nome")
        .execute()
    )

    return res.data or []


@router.post("")
def criar_usuario(body: UsuarioCreate, authorization: str | None = Header(default=None)):
    _exigir_admin(authorization)

    permissoes = _validar_permissoes(body.permissoes)
    usuario = body.usuario.strip().lower()
    email = str(body.email).strip().lower()

    try:
        auth_resp = supabase.auth.admin.create_user({
            "email": email,
            "password": body.senha,
            "email_confirm": True,
            "user_metadata": {
                "name": body.nome.strip(),
                "usuario": usuario,
            },
        })
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro criando usuário no Auth: {str(e)}")

    auth_user = getattr(auth_resp, "user", None)

    if not auth_user:
        raise HTTPException(status_code=422, detail="Usuário criado no Auth não retornou ID.")

    registro = {
        "auth_user_id": auth_user.id,
        "nome": body.nome.strip(),
        "usuario": usuario,
        "email": email,
        "perfil": body.perfil.strip().lower() if body.perfil else "usuario",
        "ativo": body.ativo,
        "permissoes": permissoes,
    }

    try:
        res = supabase.table("usuarios_app").insert(registro).execute()
    except Exception as e:
        # tenta limpar o usuário criado no Auth se falhar ao gravar perfil
        try:
            supabase.auth.admin.delete_user(auth_user.id)
        except Exception:
            pass
        raise HTTPException(status_code=422, detail=f"Erro criando perfil do usuário: {str(e)}")

    return res.data[0] if res.data else registro


@router.put("/{usuario_id}")
def atualizar_usuario(
    usuario_id: str,
    body: UsuarioUpdate,
    authorization: str | None = Header(default=None),
):
    _exigir_admin(authorization)

    payload: dict[str, Any] = {}

    if body.nome is not None:
        payload["nome"] = body.nome.strip()

    if body.usuario is not None:
        payload["usuario"] = body.usuario.strip().lower()

    if body.email is not None:
        payload["email"] = str(body.email).strip().lower()

    if body.perfil is not None:
        payload["perfil"] = body.perfil.strip().lower()

    if body.ativo is not None:
        payload["ativo"] = body.ativo

    if body.permissoes is not None:
        payload["permissoes"] = _validar_permissoes(body.permissoes)

    if not payload:
        return {"ok": True}

    payload["updated_at"] = "now()"

    try:
        res = (
            supabase.table("usuarios_app")
            .update(payload)
            .eq("id", usuario_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not res.data:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    return res.data[0]


@router.put("/{usuario_id}/senha")
def alterar_senha(
    usuario_id: str,
    body: SenhaUpdate,
    authorization: str | None = Header(default=None),
):
    _exigir_admin(authorization)

    res = (
        supabase.table("usuarios_app")
        .select("auth_user_id")
        .eq("id", usuario_id)
        .limit(1)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    auth_user_id = res.data[0].get("auth_user_id")

    if not auth_user_id:
        raise HTTPException(status_code=422, detail="Usuário sem auth_user_id vinculado.")

    try:
        supabase.auth.admin.update_user_by_id(
            auth_user_id,
            {"password": body.senha}
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro alterando senha: {str(e)}")

    return {"ok": True}


@router.delete("/{usuario_id}")
def excluir_usuario(
    usuario_id: str,
    authorization: str | None = Header(default=None),
):
    admin = _exigir_admin(authorization)

    if str(admin.get("id")) == usuario_id:
        raise HTTPException(status_code=422, detail="Você não pode excluir seu próprio usuário.")

    res = (
        supabase.table("usuarios_app")
        .select("auth_user_id")
        .eq("id", usuario_id)
        .limit(1)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    auth_user_id = res.data[0].get("auth_user_id")

    try:
        supabase.table("usuarios_app").delete().eq("id", usuario_id).execute()
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro excluindo perfil: {str(e)}")

    if auth_user_id:
        try:
            supabase.auth.admin.delete_user(auth_user_id)
        except Exception:
            pass

    return {"ok": True}