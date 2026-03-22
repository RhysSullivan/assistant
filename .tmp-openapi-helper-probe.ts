import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform';
import { startOpenApiTestServer } from '@executor/effect-test-utils';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

const ownerParam = HttpApiSchema.param('owner', Schema.String);
const repoParam = HttpApiSchema.param('repo', Schema.String);
class DemoReposApi extends HttpApiGroup.make('repos').add(
  HttpApiEndpoint.get('getRepo')`/repos/${ownerParam}/${repoParam}`.addSuccess(
    Schema.Struct({ full_name: Schema.String, private: Schema.Boolean }),
  ),
) {}
class DemoApi extends HttpApi.make('demo').add(DemoReposApi) {}
const live = HttpApiBuilder.group(DemoApi, 'repos', (handlers) =>
  handlers.handle('getRepo', ({ path, request }) => {
    console.log('auth', request.headers.authorization);
    return Effect.succeed({ full_name: `${path.owner}/${path.repo}`, private: false });
  }),
);
const main = async () => {
  const server = await startOpenApiTestServer({ apiLayer: HttpApiBuilder.api(DemoApi).pipe(Layer.provide(live)) });
  console.log('base', server.baseUrl, server.specUrl);
  const spec = await fetch(server.specUrl);
  console.log('spec', spec.status, await spec.text());
  const resp = await fetch(`${server.baseUrl}/repos/vercel/ai`, { headers: { authorization: 'Bearer test' } });
  console.log('repo', resp.status, await resp.text());
  await server.close();
};
main().catch((e) => { console.error(e); process.exit(1); });
