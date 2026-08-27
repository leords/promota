import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 não propaga rejeições de handlers async para o error middleware
// sozinho — sem isso, um erro no meio de uma query derruba o processo Node inteiro.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
