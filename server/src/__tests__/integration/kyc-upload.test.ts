/**
 * The KYC document upload path end to end: a real multipart request through
 * the real app, a real file saved by the storage provider, and a real admin
 * read of it back — not just the service function in isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

// a minimal-but-real JPEG signature — detectDocumentType only sniffs the
// leading bytes, so this is enough to prove the whole pipeline without
// shipping a binary fixture into the repo
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const NOT_A_DOCUMENT = Buffer.from('this is plain text, not an image or a pdf');

suite('KYC document upload', () => {
  let app: Express;
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let signAccessToken: (typeof import('../../lib/jwt.js'))['signAccessToken'];
  let storage: (typeof import('../../services/storage.js'))['storage'];

  const made: string[] = [];
  const savedRefs: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        email: `kyc-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'KYC Upload Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
      },
    });
    made.push(user.id);
    return user;
  };

  const kycFields = {
    fullName: 'Real Trader Name',
    dateOfBirth: '1990-05-17',
    country: 'PK',
    address: '221B Somewhere Street',
    documentType: 'PASSPORT',
    documentNumber: 'AB1234567',
  };

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.createApp();
    prisma = (await import('../../lib/prisma.js')).prisma;
    signAccessToken = (await import('../../lib/jwt.js')).signAccessToken;
    storage = (await import('../../services/storage.js')).storage;
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const ref of savedRefs) await storage.delete(ref).catch(() => undefined);
    await prisma.kycSubmission.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('saves a real uploaded document and stores its ref, not the bytes, on the submission', async () => {
    const user = await makeUser();
    const token = signAccessToken({ sub: user.id, role: user.role, email: user.email });

    const res = await request(app)
      .post('/api/me/kyc')
      .set('Authorization', `Bearer ${token}`)
      .field('fullName', kycFields.fullName)
      .field('dateOfBirth', kycFields.dateOfBirth)
      .field('country', kycFields.country)
      .field('address', kycFields.address)
      .field('documentType', kycFields.documentType)
      .field('documentNumber', kycFields.documentNumber)
      .attach('document', JPEG_BYTES, { filename: 'passport.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe('PENDING');

    const submission = await prisma.kycSubmission.findUniqueOrThrow({
      where: { id: res.body.submission.id },
    });
    expect(submission.documentRef).toBeTruthy();
    expect(submission.documentRef).toMatch(/^kyc\//);
    savedRefs.push(submission.documentRef!);

    const stored = await storage.read(submission.documentRef!);
    expect(stored).toEqual(JPEG_BYTES);
  });

  it("lets an admin with the 'support' permission read the exact bytes back", async () => {
    const user = await makeUser();
    const admin = await prisma.user.create({
      data: {
        email: `kyc-reviewer-${Date.now()}@test.dev`,
        name: 'KYC Reviewer',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        role: 'ADMIN',
        adminRole: 'SUPPORT',
        twoFactorEnabledAt: new Date(),
      },
    });
    made.push(admin.id);
    const traderToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
    const adminToken = signAccessToken({ sub: admin.id, role: admin.role, email: admin.email });

    const submitRes = await request(app)
      .post('/api/me/kyc')
      .set('Authorization', `Bearer ${traderToken}`)
      .field('fullName', kycFields.fullName)
      .field('dateOfBirth', kycFields.dateOfBirth)
      .field('country', kycFields.country)
      .field('address', kycFields.address)
      .field('documentType', kycFields.documentType)
      .field('documentNumber', kycFields.documentNumber)
      .attach('document', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

    const submissionId = submitRes.body.submission.id as string;
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    savedRefs.push(submission.documentRef!);

    const docRes = await request(app)
      .get(`/api/admin/kyc/${submissionId}/document`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(docRes.status).toBe(200);
    expect(docRes.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.compare(docRes.body as Buffer, JPEG_BYTES)).toBe(0);
  });

  it('refuses a submission whose "document" is not really an image or a PDF', async () => {
    const user = await makeUser();
    const token = signAccessToken({ sub: user.id, role: user.role, email: user.email });

    const res = await request(app)
      .post('/api/me/kyc')
      .set('Authorization', `Bearer ${token}`)
      .field('fullName', kycFields.fullName)
      .field('dateOfBirth', kycFields.dateOfBirth)
      .field('country', kycFields.country)
      .field('address', kycFields.address)
      .field('documentType', kycFields.documentType)
      .field('documentNumber', kycFields.documentNumber)
      // renamed to look like a JPEG; its bytes say otherwise
      .attach('document', NOT_A_DOCUMENT, { filename: 'passport.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('unsupported_file_type');

    const stillNotSubmitted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stillNotSubmitted.kycStatus).toBe('NOT_SUBMITTED');
  });

  it('submits without a document at all — a submission the operator can still follow up on', async () => {
    const user = await makeUser();
    const token = signAccessToken({ sub: user.id, role: user.role, email: user.email });

    const res = await request(app)
      .post('/api/me/kyc')
      .set('Authorization', `Bearer ${token}`)
      .field('fullName', kycFields.fullName)
      .field('dateOfBirth', kycFields.dateOfBirth)
      .field('country', kycFields.country)
      .field('address', kycFields.address)
      .field('documentType', kycFields.documentType)
      .field('documentNumber', kycFields.documentNumber);

    expect(res.status).toBe(201);
    const submission = await prisma.kycSubmission.findUniqueOrThrow({
      where: { id: res.body.submission.id },
    });
    expect(submission.documentRef).toBeNull();
  });
});
