import { useState } from 'react';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { useFormSubmit } from '../hooks.ts';
import { TERMS } from './terms.ts';

// Primeiro acesso (ou termos atualizados): o aceite fica registrado com a versão.
export function PortalTerms({ version, onAccepted, onLogout }: { version: string; onAccepted: () => void; onLogout: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const { busy, error, onSubmit } = useFormSubmit(async () => {
    await api.portalAcceptTerms(version);
    onAccepted();
  });

  return (
    <div className="login-layout">
      <form className="login-card portal-terms" onSubmit={onSubmit}>
        <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        <h1>Termos de uso do portal</h1>
        <div className="terms-text" tabIndex={0} aria-label="Texto dos termos de uso">
          {TERMS.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span>Li e aceito os termos de uso e o aviso de privacidade.</span>
        </label>
        <button type="submit" className="button" disabled={!agreed || busy}>{busy ? 'Salvando…' : 'Continuar'}</button>
        {error && <p className="erro" role="alert">{error}</p>}
        <button type="button" className="link-btn" onClick={onLogout}>Sair</button>
      </form>
    </div>
  );
}
