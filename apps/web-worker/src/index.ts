// The Worker's entry point. It exports the handler and nothing else, because the runtime reads every
// named export of an entry module as a handler and refuses to start on one that is not. The work,
// and the reasoning behind it, is in answer-application-file.ts.
import { answerApplicationFile, type Bindings } from "./answer-application-file.ts";

export default {
  fetch: (request: Request, environment: Bindings): Promise<Response> =>
    answerApplicationFile(request, environment.ASSETS),
};
