import { ORPCError } from "@orpc/client";
import { chatCopy } from "./copy.ts";

export function rejectionMessage(error: unknown) {
  if (!(error instanceof ORPCError)) return;
  switch (error.code) {
    case "CONFLICT":
      return chatCopy.errors.busy;
    case "PRECONDITION_FAILED":
      return chatCopy.errors.model;
    case "BAD_REQUEST":
      return chatCopy.errors.input;
  }
}
