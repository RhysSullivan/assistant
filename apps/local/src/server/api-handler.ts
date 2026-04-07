type ServerHandlers = {
  readonly api: {
    readonly handler: (request: Request) => Promise<Response>;
    readonly dispose: () => Promise<void>;
  };
  readonly mcp: {
    readonly handleRequest: (request: Request) => Promise<Response>;
    readonly close: () => Promise<void>;
  };
};

let handlersPromise: Promise<ServerHandlers> | null = null;

const getHandlers = () => {
  if (!handlersPromise) {
    handlersPromise = import("./main").then((mod) => mod.createServerHandlers());
  }
  return handlersPromise;
};

export const handleApiRequest = async (request: Request): Promise<Response> => {
  const handlers = await getHandlers();
  return handlers.api.handler(request);
};

export const handleMcpRequest = async (request: Request): Promise<Response> => {
  const handlers = await getHandlers();
  return handlers.mcp.handleRequest(request);
};
