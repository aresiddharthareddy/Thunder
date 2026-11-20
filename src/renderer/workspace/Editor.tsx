import MonacoEditor from "@monaco-editor/react";

interface Props { content: string; language: string; filePath: string; onChange: (value: string) => void; }
export function Editor({ content, language, filePath, onChange }: Props): JSX.Element {
  return <MonacoEditor height="100%" path={filePath} language={language} value={content} theme="vs-dark" onChange={(value) => onChange(value ?? "")} options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true, scrollBeyondLastLine: false }} />;
}
