// The shape of a parsed message, re-exported from the engine package that defines it.
//
// `@magna-carta/email` is the TypeScript wrapper around the email-core WebAssembly build, so naming
// it is what pulls that build into a bundle. Everything that only needs to DESCRIBE a message —
// this package's own record mapping, the app worker's capture consumer and attachment extraction —
// needs the types and not the engine, and reaches them here instead. Types are erased at compile
// time, so this module adds nothing to any bundle; what it adds is one import path that a consumer
// can hold without also holding a claim on the engine.
//
// The engine itself now runs in apps/email-worker, which owns the Container-free WebAssembly build
// and answers parse and part-extraction over its service binding.

export type {
  Address,
  EmailErrorCode,
  Integrity,
  MboxParseOutcome,
  MemberFailure,
  MessageIdentifier,
  ParsedMessage,
  PartDescriptor,
  PartLocator,
  RawHeader,
  SourceFormat,
} from "@magna-carta/email";
