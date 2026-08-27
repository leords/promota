// Decodifica o payload do JWT só para decidir qual tela mostrar (ex.: promotor vs
// gestor). NUNCA usar isto como verificação de segurança — o backend já valida a
// assinatura e a role em toda rota protegida; isto é só uma conveniência de UI.
export function decodeTokenRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}
