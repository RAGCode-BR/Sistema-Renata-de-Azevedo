// Base das Edge Functions de administração: CORS, respostas JSON e checagem de quem chama.
// Rodam com a chave de serviço, que nunca vai para o navegador; por isso só atendem administração ativa.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function reply(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}

export interface AdminContext {
  admin: SupabaseClient;
  caller: User;
  input: Record<string, unknown>;
}

// Atende só POST de administração ativa; o token da sessão é validado pelo próprio Supabase Auth.
export function serveAdmin(handler: (context: AdminContext) => Promise<Response>): void {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false }
    });
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return reply(401, { error: 'Entre na sua conta para continuar.' });
    const { data: profile } = await admin.from('profiles').select('role, active').eq('id', caller.id).maybeSingle();
    if (!profile?.active || profile.role !== 'admin') return reply(403, { error: 'Você não tem acesso a esta área.' });

    let input: Record<string, unknown>;
    try {
      input = await request.json();
    } catch {
      return reply(400, { error: 'JSON inválido.' });
    }
    try {
      return await handler({ admin, caller, input });
    } catch (error) {
      console.error(error);
      return reply(500, { error: 'Não foi possível concluir a operação.' });
    }
  });
}
