import { defineRule } from "@oxlint/plugins";

import {
  createModuleSourceVisitor,
  readStaticSpecifier,
} from "../workspace-utils.mjs";

const isEffectSource = (specifier) =>
  specifier === "effect"
  || specifier.startsWith("effect/")
  || specifier.startsWith("@effect/");

const isNodeFsSource = (specifier) =>
  specifier === "node:fs" || specifier === "node:fs/promises";

export default defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow node:fs imports in modules that already depend on Effect.",
      recommended: true,
    },
    messages: {
      noNodeFsWithEffectImports:
        "This module already depends on Effect. Do not import {{moduleName}} here. Depend on `FileSystem.FileSystem` from `@effect/platform` instead, and provide `NodeFileSystem.layer` only at the Node boundary or in tests.",
    },
  },
  create(context) {
    let hasEffectImport = false;
    const nodeFsImports = [];

    const visitSource = (sourceNode) => {
      const specifier = readStaticSpecifier(sourceNode);
      if (!specifier) {
        return;
      }

      if (isEffectSource(specifier)) {
        hasEffectImport = true;
      }

      if (isNodeFsSource(specifier)) {
        nodeFsImports.push({
          moduleName: specifier,
          node: sourceNode,
        });
      }
    };

    return {
      ...createModuleSourceVisitor(visitSource),
      "Program:exit"() {
        if (!hasEffectImport) {
          return;
        }

        for (const entry of nodeFsImports) {
          context.report({
            node: entry.node,
            messageId: "noNodeFsWithEffectImports",
            data: {
              moduleName: entry.moduleName,
            },
          });
        }
      },
    };
  },
});
