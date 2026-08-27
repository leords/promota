import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { listNotifications, type NotificationLogEntry } from '../../api/admin';

const STATUS_LABEL: Record<NotificationLogEntry['status'], string> = {
  enviada: '✅ Enviada',
  falha: '❌ Falhou',
  pulada: '— Pulada',
};

export default function NotificationsPage() {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<NotificationLogEntry[]>([]);

  useEffect(() => {
    if (token) listNotifications(token).then(setNotifications).catch(() => setNotifications([]));
  }, [token]);

  return (
    <section>
      <h2>Notificações</h2>
      <p style={{ color: '#64748b' }}>
        Histórico de avisos gerados pelo sistema (ex.: produtos próximos do vencimento). Enviados por e-mail via Resend
        quando configurado — ver <code>.env.example</code>.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
            <th>Assunto</th>
            <th>Destinatário</th>
            <th>Canal</th>
            <th>Status</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {notifications.map((n) => (
            <tr key={n.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td>{n.assunto}</td>
              <td>{n.destinatario}</td>
              <td>{n.canal}</td>
              <td title={n.erro ?? undefined}>{STATUS_LABEL[n.status]}</td>
              <td>{new Date(n.criado_em).toLocaleString('pt-BR')}</td>
            </tr>
          ))}
          {notifications.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>
                Nenhuma notificação gerada ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
