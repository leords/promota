import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type AuthClaims, type UserRole } from '../auth/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
