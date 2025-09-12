// Clerk authentication middleware for Fastify
import { FastifyRequest, FastifyReply } from 'fastify';

export interface ClerkUser {
  userId: string;
  sessionId: string;
  orgId?: string;
  orgRole?: string;
  orgSlug?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ClerkUser;
  }
}

export async function authenticateWithClerk(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { getAuth } = await import('@clerk/fastify');
  const { userId, sessionId, orgId, orgRole, orgSlug } = getAuth(request);

  if (!userId || !sessionId) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'No valid authentication found',
    });
  }

  // Attach user info to request
  request.auth = {
    userId,
    sessionId,
    orgId: orgId || undefined,
    orgRole: orgRole || undefined,
    orgSlug: orgSlug || undefined,
  };
}

export async function requireOrganization(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.auth?.orgId) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Organization membership required',
    });
  }
}