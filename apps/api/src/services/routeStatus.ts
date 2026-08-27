import type { PoolClient } from 'pg';

/**
 * Recalcula app.routes.status a partir do status agregado dos route_pdvs — chamado
 * depois de qualquer mudança de status de PDV dentro de uma rota (check-in,
 * check-out, marcar não atendido). Mantém route.status como um resumo derivado, não
 * como estado independente que alguém precisa lembrar de sincronizar.
 */
export async function refreshRouteStatus(client: PoolClient, routeId: string): Promise<void> {
  await client.query(
    `UPDATE app.routes SET status = (
       SELECT CASE
         WHEN count(*) FILTER (WHERE status IN ('concluido', 'nao_atendido')) = count(*) THEN 'concluida'
         WHEN count(*) FILTER (WHERE status IN ('em_atendimento', 'concluido', 'nao_atendido')) > 0 THEN 'em_andamento'
         ELSE 'planejada'
       END::app.route_status
       FROM app.route_pdvs WHERE route_id = $1
     )
     WHERE id = $1`,
    [routeId],
  );
}
