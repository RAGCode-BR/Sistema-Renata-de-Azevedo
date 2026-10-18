import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';

// Carrega dados ao abrir a tela e quando `deps` muda; `reload` para puxar de novo (ex.: puxar para atualizar).
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    load().then((result) => { if (current) setData(result); }, (failure: unknown) => {
      if (current) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar.');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [...deps, version]);
  return { data, error, loading, reload: useCallback(() => setVersion((value) => value + 1), []) };
}

export const message = (failure: unknown) => (failure instanceof Error ? failure.message : 'Não foi possível concluir.');

// Recarrega quando a tela volta a ficar visível (ex.: depois de criar uma tarefa e voltar à lista).
export function useReloadOnFocus(reload: () => void) {
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    reload();
  }, [reload]));
}
