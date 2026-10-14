import type { ReactNode } from 'react';

export function Heading({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="heading">
      <div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="tools">{children}</div>}
    </section>
  );
}

export function Panel({ title, tools, children }: { title: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel spaced">
      <div className="panel-head">
        <h2>{title}</h2>
        {tools}
      </div>
      {children}
    </section>
  );
}

// Conteúdo de um painel enquanto os dados carregam, em caso de erro ou sem registros.
export function PanelState({ error, loading, empty }: { error: string; loading: boolean; empty: string }) {
  if (error) return <p className="empty-state erro" role="alert">{error}</p>;
  return <p className="empty-state">{loading ? 'Carregando…' : empty}</p>;
}
