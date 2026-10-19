import { useState } from 'react';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { text, useFormSubmit } from '../hooks.ts';

// Entrada sem senha: e-mail → código de 6 dígitos (ou 8, conforme o Supabase) enviado ao e-mail.
// A mensagem é a mesma exista ou não a conta, para não revelar quem é paciente da clínica.
export function PortalLogin({ notice, onLogin }: { notice: string; onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [info, setInfo] = useState('');
  const ask = useFormSubmit(async (data) => {
    const value = text(data, 'email');
    setInfo('');
    try {
      await api.portalSendCode(value);
    } finally {
      setEmail(value);
    }
  });
  const verify = useFormSubmit(async (data) => {
    await api.portalVerifyCode(email, text(data, 'code'));
    onLogin();
  });
  // Os dois passos têm chaves diferentes (key) para o campo do código não herdar o e-mail digitado.
  // Na tela do código, o erro da tentativa de entrar vem antes do aviso do pedido de código.
  const message = (email ? verify.error || ask.error : ask.error) || notice;

  return (
    <div className="login-layout">
      {!email ? (
        <form key="email" className="login-card" onSubmit={ask.onSubmit}>
          <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
          <h1>Portal do paciente</h1>
          <p className="muted">Informe o e-mail cadastrado na clínica. Você vai receber um código para entrar.</p>
          <label className="field">
            <span>E-mail</span>
            <input className="input" name="email" type="email" autoComplete="email" inputMode="email" required />
          </label>
          <button type="submit" className="button" disabled={ask.busy}>{ask.busy ? 'Enviando…' : 'Receber código'}</button>
          {message && <p className="erro" role="alert">{message}</p>}
          <p className="muted small login-legal"><a href="/privacidade.html" target="_blank" rel="noreferrer">Política de privacidade</a></p>
        </form>
      ) : (
        <form key="code" className="login-card" onSubmit={verify.onSubmit}>
          <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
          <h1>Digite o código</h1>
          <p className="muted">Se <strong>{email}</strong> tiver acesso ao portal, um código foi enviado para ele. Confira também a caixa de spam.</p>
          <label className="field">
            <span>Código</span>
            <input className="input code-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,10}"
              maxLength={10} required autoFocus />
          </label>
          <button type="submit" className="button" disabled={verify.busy}>{verify.busy ? 'Entrando…' : 'Entrar'}</button>
          {message && <p className="erro" role="alert">{message}</p>}
          {info && <p className="muted" role="status">{info}</p>}
          <p className="login-links">
            <button type="button" className="link-btn" disabled={ask.busy} onClick={async () => {
              try { await api.portalSendCode(email); setInfo('Novo código enviado.'); } catch (failure) { setInfo(failure instanceof Error ? failure.message : ''); }
            }}>Enviar outro código</button>
            <button type="button" className="link-btn" onClick={() => { setEmail(''); setInfo(''); }}>Usar outro e-mail</button>
          </p>
        </form>
      )}
    </div>
  );
}
