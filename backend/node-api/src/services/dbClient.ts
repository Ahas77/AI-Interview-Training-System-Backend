export interface SessionRecord {
  id: string;
  candidateId?: string;
  createdAt: string;
}

export async function saveSession(session: SessionRecord): Promise<SessionRecord> {
  // Replace this adapter with Prisma, PostgreSQL, or another persistence provider.
  return session;
}
