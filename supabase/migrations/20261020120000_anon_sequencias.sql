-- Bloco 14 (segurança): visitante não logado (anon) sem nenhum privilégio no schema public.
-- O Supabase dá, por padrão, acesso às sequências (contadores de id) para anon. A API não as expõe, mas o
-- teste supabase/tests/seguranca.sql exige "nada para anon". Vale também para o que for criado depois.
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
