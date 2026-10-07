# HTTP API

The API server is implemented in `src/integrations/http-api-server.js`. It
defaults to localhost and applies configured CORS, rate limits, and optional
authentication. Configure authentication before exposing the server to an
untrusted network.

## Main endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/analyze` | Analyze a workspace |
| `POST` | `/api/fix` | Apply requested fixes |
| `GET` | `/api/status` | Read service status |
| `GET` | `/api/issues` | Read the latest issues |
| `GET` | `/api/ai/config` | Read provider/model/budget preferences |
| `POST` | `/api/ai/configure` | Update provider/model/budget preferences |
| `GET` | `/api/dashboard/status` | Read local dashboard configuration |
| `GET` | `/api/dashboard/metrics` | Read current dashboard metrics |
| `POST` | `/api/dashboard/configure` | Enable/disable local recording (management auth required) |
| `POST` | `/api/dashboard/record` | Record a dashboard snapshot |
| `GET` | `/api/plugins` | List project plugins |
| `POST` | `/api/plugins/install` | Install a workspace-local plugin (management auth required) |
| `GET` | `/api/plugins/:id` | Read plugin information |
| `DELETE` | `/api/plugins/:id` | Remove a managed plugin (management auth required) |
| `POST` | `/api/plugins/:id/enable` | Enable a plugin (management auth required) |
| `POST` | `/api/plugins/:id/disable` | Disable a plugin (management auth required) |

Additional agent, pipeline, security, and AI-generation routes are documented
in the OpenAPI document [`openapi.yaml`](./openapi.yaml). Route availability is
subject to service configuration and authentication.

Provider API keys submitted to AI configuration are kept in the server process
and are not returned by the configuration response or written to the settings
file. Do not log request bodies containing credentials.
