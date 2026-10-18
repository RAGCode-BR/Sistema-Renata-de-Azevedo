// Base das Edge Functions: CORS, respostas JSON e checagem de quem chama.
// Rodam com a chave de serviço, que nunca vai para o navegador; por isso só atendem quem tem a
// permissão "users.manage". A permissão vem do próprio banco (my_access), com o token de quem chama.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROLES = ['owner', 'manager', 'reception', 'finance', 'professional', 'patient']; // shared/permissions.ts

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function reply(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}

export interface UserContext {
  admin: SupabaseClient;
  asCaller: SupabaseClient;
  caller: User;
  input: Record<string, unknown>;
}

// Atende só POST de quem está conectado. `asCaller` consulta o banco com o token da pessoa (valem as
// permissões dela); `admin` usa a chave de serviço e só deve ser usado depois das checagens.
export function serveUser(handler: (context: UserContext) => Promise<Response>): void {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return reply(401, { error: 'Entre na sua conta para continuar.' });
    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    let input: Record<string, unknown>;
    try {
      input = await request.json();
    } catch {
      return reply(400, { error: 'JSON inválido.' });
    }
    try {
      return await handler({ admin, asCaller, caller, input });
    } catch (error) {
      console.error(error);
      return reply(500, { error: 'Não foi possível concluir a operação.' });
    }
  });
}

export type AdminContext = Omit<UserContext, 'asCaller'>;

// Como serveUser, mas só para quem tem a permissão "users.manage" (vinda do banco, via my_access).
export function serveAdmin(handler: (context: AdminContext) => Promise<Response>): void {
  serveUser(async ({ admin, asCaller, caller, input }) => {
    const { data: access } = await asCaller.rpc('my_access');
    if (!access?.permissions?.includes('users.manage')) return reply(403, { error: 'Você não tem acesso a esta área.' });
    return handler({ admin, caller, input });
  });
}
