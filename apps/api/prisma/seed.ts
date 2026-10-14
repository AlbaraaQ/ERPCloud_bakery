import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@erpcloud/shared';
const prisma = new PrismaClient();
async function main() {
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@example.com';
  const password = process.env.SEED_OWNER_PASSWORD; if (!password) throw new Error('SEED_OWNER_PASSWORD is required');
  const existing = await prisma.tenant.findUnique({ where: { slug: 'demo' } }); if (existing) { console.log('demo tenant exists; skipping'); return; }
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.platform_access','on',true)`;
    const tenant = await tx.tenant.create({ data: { name: 'شركة تجريبية', slug: 'demo' } });
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    for (const p of PERMISSIONS) await tx.permission.upsert({ where:{code:p}, create:{code:p}, update:{} });
    const owner = await tx.user.create({ data: { tenantId: tenant.id, email, passwordHash: await argon2.hash(password,{type:argon2.argon2id}), displayName: 'مالك الشركة' } });
    for (const [code, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await tx.role.create({ data: { tenantId: tenant.id, code, name: code } });
      const rows = await tx.permission.findMany({ where: { code: { in: perms as unknown as string[] } } });
      for (const r of rows) await tx.rolePermission.create({ data: { roleId: role.id, permissionId: r.id } });
      if (code==='TENANT_OWNER') await tx.userRole.create({ data: { userId: owner.id, roleId: role.id } });
    }
    await tx.subscriptionPlan.upsert({ where:{code:'starter'}, create:{code:'starter', name:'الأساسية'}, update:{} });
    console.log(`Seeded tenant demo, owner ${email}`);
  });
}
main().finally(()=>prisma.$disconnect());
