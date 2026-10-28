import type { SessionUser } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { secret, text, useFormSubmit } from '../hooks.ts';

export function LoginPage({ notice, onLogin }: { notice: string; onLogin: (user: SessionUser) => void }) {
  const { busy, error, onSubmit } = useFormSubmit(async (data) => {
    await api.login(text(data, 'username'), secret(data, 'password'));
    const user = await api.session();
    if (!user) {
      const patient = await api.isPatientAccount().catch(() => false);
      await api.logout();
      if (patient) {
        window.location.hash = '#/portal';
        return;
      }
      throw new Error('Esta conta não tem acesso ao sistema.');
    }
    onLogin(user);
  });
  const message = error || notice;

  return (
    <div className="login-layout">
      <form className="login-card" onSubmit={onSubmit}>
        <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        <h1>Entrar no sistema</h1>
        <p className="muted">Área reservada à equipe da clínica.</p>
        <label className="field">
          <span>Login</span>
          <input className="input" name="username" type="text" autoCapitalize="none" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Senha</span>
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" className="button" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        {message && <p className="erro" role="alert">{message}</p>}
        <p className="muted small login-legal"><a href="/privacidade.html" target="_blank" rel="noreferrer">Política de privacidade</a></p>
      </form>
    </div>
  );
}
