# Notes on the architecture of Executor.

## What is Executor?

Executor is meant to be a replacement for how agents use bash and CLIs today, replacing it with code execution.

The philosophy behind this is that bash + CLIs is a fundamentally flawed approach in that it is not going to be able to scale to organizations securely, is too dependant on having a vm to execute in, and has too many security flaws for things that can be generally run in a sandbox

It is important to call out however what bash gets right, bash and CLIs are not bad primitives - they're the best approach agents have for calling services today

### Why is bash the wrong primitive?

Look at the attempts to make bash secure, namely [https://github.com/NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell)

- Requires having docker running
- Single player

### Why is code mode likely the right primitive?

Portability, types, searchable index of all tools, unified interface

[https://sunilpai.dev/posts/after-wimp/](https://sunilpai.dev/posts/after-wimp/)

### What is Executor doing right that others haven't?

Configuring itself, normalize to a TypeScript SDK but that's it, preserve complexity inside of plugins don't try to force a shared schema

### What is going to be hard?

- Distribution

## Targets

SaaS:

- Organizations are able to use it to allow their employees to connect to services, examples:
  - "Give all of my sales team access to Salesforce via just setting 1 API key and then they can OAuth"
  - "All of my employees can OAuth with their own Google Workspace to setup their connections"
- Products embedding it inside of them, i.e "bring your own integrations" to another persons AI assistant

Local:

- Locally installable desktop application
- Be able to npx add-mcp executor and just start using it

SDK:

- Bring your AI SDK tools
- Leverage the plugin ecosystem to convert OpenAPI / GraphQL / etc into callable tools

## Architecture

All of these build on similar concepts and primitives

The underlying concept is that you can generate a TypeScript SDK for literally anything you want to interact with, and the LLMs can call it

Scope contains:

- Secrets
- Policies
- Sources
  - Tools

### Scopes

Scopes contain sources, sources contain tools
Scopes can be merged, for instance you may have:

- Remote organization scope
- Remote workspace scope
- Local scope

### Secrets

#### Merging Scopes

Q) How does merging secrets work with scopes? i.e I need to enforce people set their own tokens on sources

A) TBD no idea

Q) How does merging poliices work with scopes? i.e people can override

A) TBD no idea

### Tools

A tool is a function call

Requirements to think through:

- Do tools have access to the full JS ecosystem? i.e streams
- Tools are seralizable in some form to enable workflow style use

## Plugins

Plugin list (non comphrensive):

- Import / Manage OpenAPI
- Import / Manage GraphQL
- Import / Manage Google Discovery sources
- Import / Manage MCP
- Execution history
- 1password secrets
- Keychain secrets
- Storage backed secrets
- MCP apps
- Custom tools plugin
  - Allows the agent to write .ts files w/ custom tools, plugs in to whatever relevant storage
  - Agent gets install commands for packages, typecheck etc mini dev environment to work in

Plugins:

- Can register frontend routes
- Can register themselves in the app sidebar
- Can register HTTP routes
- Can extend the core sdk

Plugins get access to the core sdk and so they are able to extend off of it

## Is this work still relevant post AGI?

While my day to day experience with the models begs to differ, if we assume the token sellers are correct most software is obsolete by 2028

Where I believe this is relevant still is that
