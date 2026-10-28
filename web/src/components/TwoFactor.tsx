import { useEffect, useRef, useState } from 'react';
import type { MfaEnrollment } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { errorMessage, text, useFormSubmit, useLoad } from '../hooks.ts';
import { Modal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

const CODE_PROPS = { inputMode: 'numeric', autoComplete: 'one-time-code', pattern: '[0-9 ]{6,7}', maxLength: 7, required: true } as const;

// Cadastro do app autenticador: QR code (ou chave para digitar) e o primeiro código para confirmar.
function Enroll({ onDone }: { onDone: () => void }) {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [error, setError] = useState('');
  const confirm = useFormSubmit(async (data) => {
    await api.mfaVerify(text(data, 'code'), enrollment!.factorId);
    onDone();
  });
  // Uma vez só (em desenvolvimento o React monta duas vezes; dois cadastros ao mesmo tempo conflitam).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.mfaEnroll().then(setEnrollment, (failure) => setError(errorMessage(failure)));
  }, []);

  if (error) return <p className="erro" role="alert">{error}</p>;
  if (!enrollment) return <p className="muted">Preparando…</p>;
  return (
    <form className="stack mfa-enroll" onSubmit={confirm.onSubmit}>
      <ol className="mfa-steps">
        <li>Instale um app autenticador no celular (Google Authenticator, Microsoft Authenticator ou 1Password, por exemplo).</li>
        <li>No app, adicione uma conta lendo este QR code:</li>
      </ol>
      <img className="mfa-qr" src={enrollment.qrCode} alt="QR code para cadastrar o app autenticador" width={180} height={180} />
      <details>
        <summary>Não consegue ler? Digite a chave</summary>
        <code className="mfa-secret">{enrollment.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
      </details>
      <label className="field">
        <span>3. Digite o código de 6 dígitos que aparece no app</span>
        <input className="input code-input" name="code" {...CODE_PROPS} />
      </label>
      {confirm.error && <p className="erro" role="alert">{confirm.error}</p>}
      <button type="submit" className="button" disabled={confirm.busy}>{confirm.busy ? 'Conferindo…' : 'Ativar'}</button>
    </form>
  );
}

// Tela cheia, logo depois de entrar: pede o código (ou o cadastro, quando a clínica exige e ainda não há app).
export function MfaGate({ mode, onDone, onLogout }: { mode: 'verify' | 'enroll'; onDone: () => void; onLogout: () => void }) {
  const verify = useFormSubmit(async (data) => {
    await api.mfaVerify(text(data, 'code'));
    onDone();
  });
  return (
    <div className="login-layout">
      <div className="login-card">
        <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        {mode === 'verify' ? (
          <form className="stack" onSubmit={verify.onSubmit}>
            <h1>Verificação em duas etapas</h1>
            <p className="muted">Abra o app autenticador no celular e digite o código da clínica.</p>
            <label className="field">
              <span>Código</span>
              <input className="input code-input" name="code" autoFocus {...CODE_PROPS} />
            </label>
            {verify.error && <p className="erro" role="alert">{verify.error}</p>}
            <button type="submit" className="button" disabled={verify.busy}>{verify.busy ? 'Conferindo…' : 'Entrar'}</button>
          </form>
        ) : (
          <>
            <h1>Ative a verificação em duas etapas</h1>
            <p className="muted">A clínica exige um código do celular, além da senha, para quem tem acesso de Proprietária ou Gerência.</p>
            <Enroll onDone={onDone} />
          </>
        )}
        <button type="button" className="link-btn" onClick={onLogout}>Sair</button>
      </div>
    </div>
  );
}
