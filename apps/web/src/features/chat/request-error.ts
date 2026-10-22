import { ORPCError } from "@orpc/client";
import { chatCopy } from "./copy.ts";

export function rejectionMessage(error: unknown) {
  if (!(error instanceof ORPCError)) return;
  const detail =
    error.message !== new ORPCError(error.code).message
      ? error.message
      : undefined;
  switch (error.code) {
    case "CONFLICT":
      return detail ?? chatCopy.errors.busy;
    case "PRECONDITION_FAILED":
      return chatCopy.errors.model;
    case "BAD_REQUEST":
      return detail ?? chatCopy.errors.input;
    case "NOT_FOUND":
      return detail ?? chatCopy.errors.file;
  }
}
