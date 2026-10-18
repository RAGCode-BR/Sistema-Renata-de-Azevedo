import { api } from '../api.ts';
import { useToast } from './Toast.tsx';
import { Field, FormModal } from './Modal.tsx';
import { text, useLoad } from '../hooks.ts';

// Aviso de novas tarefas no WhatsApp da própria pessoa (texto genérico com link; nada do conteúdo).
export function WhatsappNoticeDialog({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const { data } = useLoad(api.myWhatsapp, []);
  return (
    <FormModal title="Avisos no WhatsApp" submitLabel="Salvar" onClose={onClose} onSubmit={async (form) => {
      await api.setMyWhatsapp(text(form, 'phone'), form.get('notify') === 'on');
      notify('Preferência salva.');
    }}>
      {data ? <>
        <Field label="Seu celular (com DDD)" full><input className="input" name="phone" type="tel" defaultValue={data.phone ?? ''} placeholder="(21) 99999-0000" /></Field>
        <label className="check full"><input type="checkbox" name="notify" defaultChecked={data.notify} />
          <span>Avisar no WhatsApp quando eu receber uma tarefa<span className="sub">A mensagem traz só um link para o sistema; o conteúdo da tarefa não vai pelo WhatsApp. Funciona quando o WhatsApp da clínica estiver ativo.</span></span>
        </label>
      </> : <p className="muted full">Carregando…</p>}
    </FormModal>
  );
}
