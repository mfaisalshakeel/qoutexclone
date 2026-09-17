import type { KycSubmission } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { conflict, notFound } from '../lib/errors.js';
import { settings } from './settings.js';

export const DOCUMENT_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVING_LICENCE'] as const;

export interface KycInput {
  userId: string;
  fullName: string;
  dateOfBirth: string;
  country: string;
  address: string;
  documentType: (typeof DOCUMENT_TYPES)[number];
  documentNumber: string;
  documentRef?: string;
}

/**
 * Files themselves are not stored here — `documentRef` points at whatever
 * document store the operator uses, so identity scans never land in the
 * trading database.
 */
export async function submitKyc(input: KycInput): Promise<KycSubmission> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { kycStatus: true } });
  if (!user) throw notFound('Account not found');
  if (user.kycStatus === 'APPROVED') throw conflict('Your identity is already verified', 'already_verified');
  if (user.kycStatus === 'PENDING')
    throw conflict('A verification request is already under review', 'already_pending');

  const [submission] = await prisma.$transaction([
    prisma.kycSubmission.create({
      data: {
        userId: input.userId,
        fullName: input.fullName.trim(),
        dateOfBirth: input.dateOfBirth,
        country: input.country.trim(),
        address: input.address.trim(),
        documentType: input.documentType,
        documentNumber: input.documentNumber.trim(),
        documentRef: input.documentRef,
        status: 'PENDING',
      },
    }),
    prisma.user.update({ where: { id: input.userId }, data: { kycStatus: 'PENDING' } }),
  ]);
  return submission;
}

export async function reviewKyc(
  submissionId: string,
  reviewerId: string,
  decision: 'APPROVED' | 'REJECTED',
  note?: string,
): Promise<KycSubmission> {
  const submission = await prisma.kycSubmission.findUnique({ where: { id: submissionId } });
  if (!submission) throw notFound('Verification request not found');
  if (submission.status !== 'PENDING') throw conflict('This request was already reviewed', 'bad_status');

  const [updated] = await prisma.$transaction([
    prisma.kycSubmission.update({
      where: { id: submissionId },
      data: { status: decision, note, reviewedById: reviewerId, reviewedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: submission.userId },
      data: { kycStatus: decision, kycReviewedAt: new Date() },
    }),
  ]);
  return updated;
}

/**
 * Whether a withdrawal of `amountCents` may proceed for this verification
 * status. A threshold of 0 means every withdrawal needs verification.
 */
export function kycBlocksWithdrawal(kycStatus: string, amountCents: number): boolean {
  if (!settings.get('compliance.requireKycForWithdrawal')) return false;
  if (kycStatus === 'APPROVED') return false;
  const threshold = Math.round(settings.get('compliance.kycWithdrawalThresholdUsd') * 100);
  return amountCents > threshold;
}

export function listKycSubmissions(status?: string) {
  return prisma.kycSubmission.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { email: true, name: true, realBalance: true } } },
  });
}

export function latestKycSubmission(userId: string) {
  return prisma.kycSubmission.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
}
