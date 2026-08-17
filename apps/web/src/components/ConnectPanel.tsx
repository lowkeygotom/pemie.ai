import { describeToolAccess, type AgentPrompt } from "@pemie/shared";
import { useTranslation } from "react-i18next";
import { Collapsible, CodeBlock, Notice } from "./ui.js";

export function CapabilityReceipt({ prompt }: { prompt: AgentPrompt }) {
  const { t } = useTranslation("common");
  return (
    <div className="rounded-md border border-line-200 bg-surface-50 p-3 text-body-sm text-ink-600">
      <p>
        {t("capabilityReceipt", { included: prompt.included.length, total: prompt.included.length + prompt.excluded.length })}
      </p>
      {prompt.excluded.length ? (
        <Collapsible title={t("excludedTools")} className="mt-3 bg-surface-0">
          <ul className="space-y-1.5 font-mono text-caption text-ink-600">
            {prompt.excluded.map(({ tool, needs }) => <li key={tool}>{tool} — {t("enableWith", { needs: describeToolAccess(needs) })}</li>)}
          </ul>
        </Collapsible>
      ) : null}
    </div>
  );
}

export function ConnectPanel({
  prompt,
  apiKey,
  mcpUrl,
  showKey = true,
  onCopy,
}: {
  prompt: AgentPrompt;
  apiKey: string;
  mcpUrl: string;
  showKey?: boolean;
  onCopy?: () => void;
}) {
  const { t } = useTranslation("common");
  const curl = `curl -X POST ${mcpUrl} \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;
  return (
    <div className="space-y-4">
      {showKey ? (
        <>
          <Notice tone="warning">{t("keyShownOnce")}</Notice>
          <CodeBlock title="API key" onCopy={onCopy}>{apiKey}</CodeBlock>
        </>
      ) : null}
      <CodeBlock title="SYSTEM PROMPT" onCopy={onCopy}>{prompt.text}</CodeBlock>
      <CapabilityReceipt prompt={prompt} />
      <Collapsible title={t("manualConnection")} description={t("manualConnectionDescription")}>
        <div className="space-y-3">
          <CodeBlock title="Endpoint" onCopy={onCopy}>{mcpUrl}</CodeBlock>
          <CodeBlock title="tools/list" onCopy={onCopy}>{curl}</CodeBlock>
        </div>
      </Collapsible>
    </div>
  );
}
