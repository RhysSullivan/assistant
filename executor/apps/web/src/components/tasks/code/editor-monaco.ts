import type { EditorProps, Monaco } from "@monaco-editor/react";

const DIAGNOSTIC_CODES_TO_IGNORE = [
  1108,
  1375,
  1378,
  2307,
  80005,
];

export function setDiagnosticsOptions(monaco: Monaco, suppressSemantic: boolean) {
  const ts = monaco.languages.typescript;
  ts.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: suppressSemantic,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: DIAGNOSTIC_CODES_TO_IGNORE,
  });
}

export function configureJavascriptDefaults(monaco: Monaco, suppressSemantic: boolean) {
  const ts = monaco.languages.typescript;

  setDiagnosticsOptions(monaco, suppressSemantic);

  ts.javascriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowNonTsExtensions: true,
    checkJs: true,
    strict: false,
    noEmit: true,
    allowJs: true,
    lib: ["esnext"],
  });

  ts.javascriptDefaults.setEagerModelSync(true);

  return ts;
}

export function defineExecutorThemes(monaco: Monaco) {
  monaco.editor.defineTheme("executor-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "7f8692", fontStyle: "italic" },
      { token: "keyword", foreground: "0f8a6a" },
      { token: "string", foreground: "a46822" },
      { token: "number", foreground: "a46822" },
      { token: "type", foreground: "0f8a6a" },
      { token: "function", foreground: "5c470f" },
      { token: "variable", foreground: "1f2430" },
      { token: "operator", foreground: "6f7785" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1f2430",
      "editor.lineHighlightBackground": "#f4f7fb",
      "editor.selectionBackground": "#c7def5",
      "editor.inactiveSelectionBackground": "#dbe8f7",
      "editorCursor.foreground": "#0f8a6a",
      "editorLineNumber.foreground": "#9aa3b2",
      "editorLineNumber.activeForeground": "#6f7785",
      "editorIndentGuide.background": "#e3e8ef",
      "editorIndentGuide.activeBackground": "#ccd5e2",
      "editor.selectionHighlightBackground": "#c7def540",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#d6dde8",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#d6dde8",
      "editorSuggestWidget.selectedBackground": "#cfe1f6",
      "editorSuggestWidget.selectedForeground": "#111827",
      "editorSuggestWidget.selectedIconForeground": "#0f8a6a",
      "editorSuggestWidget.highlightForeground": "#0f8a6a",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#d6dde8",
      "list.focusBackground": "#cfe1f6",
      "list.focusForeground": "#111827",
      "list.highlightForeground": "#0f8a6a",
      "input.background": "#ffffff",
      "input.border": "#d6dde8",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#c2cad880",
      "scrollbarSlider.hoverBackground": "#a6afbe",
      "scrollbarSlider.activeBackground": "#8f98a8",
      "focusBorder": "#0f8a6a30",
    },
  });

  monaco.editor.defineTheme("executor-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5a6370", fontStyle: "italic" },
      { token: "keyword", foreground: "6bdfb8" },
      { token: "string", foreground: "c4a46c" },
      { token: "number", foreground: "c4a46c" },
      { token: "type", foreground: "6bdfb8" },
      { token: "function", foreground: "dcdcaa" },
      { token: "variable", foreground: "c8ccd4" },
      { token: "operator", foreground: "8a93a5" },
    ],
    colors: {
      "editor.background": "#0f1117",
      "editor.foreground": "#c8ccd4",
      "editor.lineHighlightBackground": "#161922",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#1d2536",
      "editorCursor.foreground": "#6bdfb8",
      "editorLineNumber.foreground": "#3a3f4b",
      "editorLineNumber.activeForeground": "#5a6370",
      "editorIndentGuide.background": "#1e2230",
      "editorIndentGuide.activeBackground": "#2a3040",
      "editor.selectionHighlightBackground": "#264f7830",
      "editorWidget.background": "#161922",
      "editorWidget.border": "#2a3040",
      "editorSuggestWidget.background": "#161922",
      "editorSuggestWidget.border": "#2a3040",
      "editorSuggestWidget.selectedBackground": "#1d2a3a",
      "editorSuggestWidget.highlightForeground": "#6bdfb8",
      "editorHoverWidget.background": "#161922",
      "editorHoverWidget.border": "#2a3040",
      "input.background": "#0f1117",
      "input.border": "#2a3040",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#2a304080",
      "scrollbarSlider.hoverBackground": "#3a4050",
      "scrollbarSlider.activeBackground": "#4a5060",
      "focusBorder": "#6bdfb830",
    },
  });
}

export const CODE_EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fixedOverflowWidgets: true,
  fontSize: 13,
  lineHeight: 22,
  fontFamily: "var(--font-geist-mono), 'JetBrains Mono', monospace",
  fontLigatures: true,
  tabSize: 2,
  padding: { top: 12, bottom: 12 },
  scrollBeyondLastLine: false,
  renderLineHighlight: "gutter",
  guides: {
    indentation: true,
    bracketPairs: true,
  },
  bracketPairColorization: {
    enabled: true,
  },
  suggest: {
    showMethods: true,
    showFunctions: true,
    showFields: true,
    showVariables: true,
    showModules: true,
    showProperties: true,
    showKeywords: true,
    preview: true,
    shareSuggestSelections: true,
  },
  quickSuggestions: {
    other: true,
    comments: false,
    strings: true,
  },
  acceptSuggestionOnCommitCharacter: true,
  parameterHints: {
    enabled: true,
    cycle: true,
  },
  inlineSuggest: {
    enabled: true,
  },
  wordWrap: "on",
  automaticLayout: true,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollbar: {
    vertical: "auto",
    horizontal: "auto",
    verticalScrollbarSize: 6,
    horizontalScrollbarSize: 6,
  },
  roundedSelection: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  smoothScrolling: true,
} satisfies NonNullable<EditorProps["options"]>;
