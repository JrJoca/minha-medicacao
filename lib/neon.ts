import { createClient, SupabaseAuthAdapter } from "@neondatabase/neon-js";

function createBackend() {
  const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
  const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL;
  if (!authUrl || !dataApiUrl) {
    throw new Error("O acesso à aplicação ainda não foi configurado neste ambiente.");
  }
  return createClient({
    auth: { url: authUrl, adapter: SupabaseAuthAdapter() },
    dataApi: { url: dataApiUrl },
  });
}

let backend: ReturnType<typeof createBackend> | undefined;

export function getBackend() {
  return (backend ??= createBackend());
}

export type ApplicationUser = {
  id: string;
  authId: string;
  email?: string;
  role: "owner" | "viewer";
  ownerUserId: string | null;
};

// O ID e o papel vêm da RPC protegida, nunca de metadados editáveis do login.
export async function resolveApplicationUser(identity: { id: string; email?: string }) {
  const client = getBackend();
  let result = await client.rpc("application_context");
  if (result.error) throw new Error("Não foi possível verificar o acesso à conta.");
  if (!result.data?.length) {
    result = await client.rpc("register_application_account");
    if (result.error) {
      throw new Error("Confirme seu e-mail. Contas em migração precisam ter o acesso vinculado antes de entrar.");
    }
  }
  const context = result.data?.[0];
  if (!context || !["owner", "viewer"].includes(context.role)) {
    throw new Error("Esta conta ainda não tem acesso à aplicação.");
  }
  return {
    id: context.user_id,
    authId: identity.id,
    email: identity.email,
    role: context.role,
    ownerUserId: context.owner_user_id,
  } as ApplicationUser;
}

export function loginEmail(value: string) {
  const login = value.trim();
  if (login.toLowerCase() !== "visualizador") return login;
  const alias = import.meta.env.VITE_VIEWER_LOGIN_EMAIL;
  if (!alias) throw new Error("Use o e-mail da conta visualizadora para entrar.");
  return alias;
}

export function getPasswordAuth() {
  return getBackend().auth.getBetterAuthInstance();
}
