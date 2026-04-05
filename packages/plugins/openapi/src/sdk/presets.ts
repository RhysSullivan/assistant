export interface OpenApiPreset {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly url: string;
  readonly icon?: string;
}

export const openApiPresets: readonly OpenApiPreset[] = [
  {
    id: "stripe",
    name: "Stripe",
    summary: "Payments, subscriptions, customers, and invoices.",
    url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    icon: "https://stripe.com/favicon.ico",
  },
  {
    id: "github-rest",
    name: "GitHub REST",
    summary: "Repos, issues, pull requests, actions, and users.",
    url: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    icon: "https://github.com/favicon.ico",
  },
  {
    id: "asana",
    name: "Asana",
    summary: "Tasks, projects, teams, and workspace management.",
    url: "https://raw.githubusercontent.com/APIs-guru/openapi-directory/main/APIs/asana.com/1.0/openapi.yaml",
    icon: "https://asana.com/favicon.ico",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    summary: "DNS, workers, pages, R2, and security rules.",
    url: "https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json",
    icon: "https://cloudflare.com/favicon.ico",
  },
  {
    id: "vercel",
    name: "Vercel",
    summary: "Deployments, domains, projects, and edge config.",
    url: "https://openapi.vercel.sh",
    icon: "https://vercel.com/favicon.ico",
  },
  {
    id: "twilio",
    name: "Twilio",
    summary: "SMS, voice, video, and messaging APIs.",
    url: "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
    icon: "https://twilio.com/favicon.ico",
  },
  {
    id: "neon",
    name: "Neon",
    summary: "Serverless Postgres — projects, branches, and endpoints.",
    url: "https://neon.tech/api_spec/release/v2.json",
    icon: "https://neon.tech/favicon/favicon.ico",
  },
  {
    id: "digitalocean",
    name: "DigitalOcean",
    summary: "Droplets, Kubernetes, databases, and networking.",
    url: "https://raw.githubusercontent.com/digitalocean/openapi/main/specification/DigitalOcean-public.v2.yaml",
    icon: "https://www.digitalocean.com/_next/static/media/favicon.594d6067.ico",
  },
];
