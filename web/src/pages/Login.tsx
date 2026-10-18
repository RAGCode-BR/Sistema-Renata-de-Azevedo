import type { SessionUser } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { secret, text, useFormSubmit } from '../hooks.ts';

export function LoginPage({ notice, onLogin }: { notice: string; onLogin: (user: SessionUser) => void }) {
  const { busy, error, onSubmit } = useFormSubmit(async (data) => {
    await api.login(text(data, 'email'), secret(data, 'password'));
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
          <span>E-mail</span>
          <input className="input" name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Senha</span>
          <input className="input" name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" className="button" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        {message && <p className="erro" role="alert">{message}</p>}
      </form>
    </div>
  );
}
