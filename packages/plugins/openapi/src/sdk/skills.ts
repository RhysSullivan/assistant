import type { Skill } from "@executor/plugin-skills";

// Skills shipped alongside the OpenAPI plugin. Consumers wire them in by
// passing this array to `skillsPlugin({ skills: [...openapiSkills] })`.
// Every skill id is prefixed `openapi.` so a catch-all `tools.list({ query: "openapi" })`
// surfaces it next to the real openapi tools.
export const openapiSkills: readonly Skill[] = [
  {
    id: "openapi.adding-a-source",
    description:
      "How to add an OpenAPI spec as a source — preview, resolve auth, then addSpec",
    body: `# Adding an OpenAPI source

The full flow to register an OpenAPI document as a source on the current
executor. Three tools, called in order.

## 1. Preview the spec

Call \`openapi.previewSpec\` with the raw spec string (JSON or YAML). You
get back:

- the operations that will be registered as tools
- any security schemes declared in the spec (API key, bearer, OAuth2, …)
- the resolved server base URL

**Why this step:** the preview tells you whether the spec needs
credentials, and which scheme to use. Do not skip it — \`addSpec\` will
fail at invoke time if required auth isn't wired.

## 2. Resolve authentication

Look at the preview's \`securitySchemes\`:

- **API key / bearer** — ask the user for the value, then store it via
  \`secrets.set\` under an id you'll reference in step 3. Pick a
  descriptive id like \`\${namespace}-api-key\`.
- **OAuth2 (authorization code)** — call \`openapi.startOAuth\` with the
  spec and the scheme name. It returns a URL to open in the browser;
  when the user completes the flow, \`openapi.completeOAuth\` stores the
  token for you.
- **OAuth2 (client credentials)** — store the client id/secret as
  secrets; the invoker will mint access tokens on demand.
- **No auth declared** — skip straight to step 3.

## 3. Register the source

Call \`openapi.addSource\` with:

- \`spec\` — the same spec string from step 1
- \`namespace\` — short slug used as the source id (e.g. \`"linear"\`)
- \`baseUrl\` — optional override of the spec's server URL
- \`headers\` — optional static headers, with secret references
  (\`{ "Authorization": { "$secret": "linear-api-key", format: "Bearer {}" } }\`)

On success you get \`{ sourceId, toolCount }\`. Every operation becomes a
tool under \`<namespace>.<operationId>\`, listable via
\`tools.list({ sourceId: namespace })\`.

## Common mistakes

- Calling \`addSpec\` before \`previewSpec\` — you'll miss required auth
  schemes and invocations will 401 later.
- Storing the API key at the wrong scope — write it to the same scope
  the source will live in (the outermost scope by default).
- Passing the spec URL instead of the spec string — \`addSpec\` expects
  the document body, not a URL. Fetch it first.
`,
  },
];
