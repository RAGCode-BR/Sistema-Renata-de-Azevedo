import { useCallback, useEffect, useState } from 'react';
import type { DependencyList, FormEvent } from 'react';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

interface Loaded<T> {
  data: T | undefined;
  error: string;
  // true enquanto busca dados novos (inclusive ao recarregar, quando `data` ainda é o anterior).
  loading: boolean;
  reload: () => void;
}

// Carrega dados da API quando a tela abre ou quando `deps` muda.
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setError('');
    setLoading(true);
    load().then(
      (result) => { if (current) setData(result); },
      (failure: unknown) => { if (current) setError(errorMessage(failure)); }
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [...deps, version]);

  return { data, error, loading, reload: useCallback(() => setVersion((value) => value + 1), []) };
}

// Envia um formulário, mostra o erro do servidor e limpa os campos ao concluir.
export function useFormSubmit(action: (data: FormData) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await action(new FormData(form));
      form.reset();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, onSubmit };
}

export function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

// Senhas são enviadas como digitadas, sem remover espaços.
export function secret(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

const readRoute = () => window.location.hash.replace(/^#\/?/, '');

export function useHashRoute(): string {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
