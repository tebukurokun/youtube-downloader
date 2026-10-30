import type { ErrorResponse, PublicError } from "@app/shared";
import type { FastifyReply } from "fastify";

export function sendError(reply: FastifyReply, statusCode: number, error: PublicError): FastifyReply {
  const body: ErrorResponse = { error };
  return reply.code(statusCode).send(body);
}
