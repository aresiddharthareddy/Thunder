import { useState } from "react";
import { Editor } from "./Editor";
import { ChatPanel } from "./ChatPanel";
const SAMPLE = "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n";
export function Workspace({ modelId }: { modelId: string }): JSX.Element { const [content, setContent] = useState(SAMPLE); return <main className="workspace"><div className="editor-pane"><div className="file-tab">sample.ts</div><Editor content={content} language="typescript" filePath="sample.ts" onChange={setContent} /></div><ChatPanel modelId={modelId} /></main>; }
