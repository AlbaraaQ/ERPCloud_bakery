import { Body, Controller, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { tenantStorage } from '../tenancy/tenant-context';
const LoginDto = z.object({ tenantSlug: z.string().min(1), email: z.string().email(), password: z.string().min(1) });
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('login')
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const dto = LoginDto.parse(body);
    const r = await this.auth.login(dto.tenantSlug, dto.email, dto.password, req.ip);
    res.cookie('erp_session', r.accessToken, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV==='production', path: '/' });
    const { accessToken, refreshToken, ...safe } = r; void accessToken; void refreshToken;
    return safe; // tokens are cookie-only; never returned in body
  }
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = (req as any).cookies?.erp_session; if (t) await this.auth.logout(t);
    res.clearCookie('erp_session'); return { ok: true };
  }
  @Post('me')
  async me(@Req() req: Request) {
    const t = (req as any).cookies?.erp_session; if (!t) throw new UnauthorizedException('غير مصرح');
    const ctx = await this.auth.authenticate(t);
    return tenantStorage.run(ctx, () => ({ userId: ctx.userId, tenantId: ctx.tenantId, permissions: ctx.permissions }));
  }
}
