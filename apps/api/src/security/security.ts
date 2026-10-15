import type { Request, Response, NextFunction } from 'express';
/** Minimal in-process rate limiter (per key). Production multi-instance deployments
 *  should back this with Redis — documented in OPERATIONS.md. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (arr.length >= this.limit) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr); return true;
  }
}
export const authLimiter = new RateLimiter(10, 60_000); // 10 login attempts / minute / ip+tenant
export function rateLimitAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path.endsWith('/auth/login') || req.path.endsWith('/platform/login')) {
    const key = `${req.ip}:${(req.body as any)?.tenantSlug ?? 'platform'}`;
    if (!authLimiter.allow(key)) return res.status(429).json({ code: 'RATE_LIMITED', message: 'محاولات كثيرة — حاول بعد دقيقة' });
  }
  return next();
}
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return next();
}
/** Origin check for cookie-authenticated mutations: a present Origin must match WEB_ORIGIN. */
export function originCheck(req: Request, res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map(s => s.trim());
    if (origin && !allowed.includes(origin)) return res.status(403).json({ code: 'ORIGIN_FORBIDDEN', message: 'مصدر الطلب غير مسموح' });
  }
  return next();
}
export function passwordPolicy(pw: string): string | null {
  if (!pw || pw.length < 10) return 'كلمة المرور يجب أن تكون 10 أحرف على الأقل';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'كلمة المرور يجب أن تجمع حروفاً وأرقاماً';
  return null;
}
