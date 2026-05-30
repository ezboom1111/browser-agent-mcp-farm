import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { toToolError } from "./farm-error.js";
import { FarmService } from "./farm-service.js";
import {
  AcquireContextInputSchema,
  CaptureAfterIdleInputSchema,
  CaptureInputSchema,
  ClickInputSchema,
  ClosePageInputSchema,
  FillInputSchema,
  EvidenceRunInputSchema,
  HeartbeatInputSchema,
  ListLeasesInputSchema,
  OpenPageInputSchema,
  PressInputSchema,
  ReapExpiredInputSchema,
  ReleaseContextInputSchema,
  SampleFramesInputSchema,
  ScrollInputSchema,
  SelectOptionInputSchema,
  WaitForSelectorInputSchema,
  WaitInputSchema
} from "./schemas.js";

export function createMcpServer(service = new FarmService()): McpServer {
  const server = new McpServer({
    name: "browser-agent-mcp-farm",
    version: "0.3.0"
  });

  registerJsonTool(server, "farm_acquire_context", AcquireContextInputSchema, (input) => service.acquireContext(input));
  registerJsonTool(server, "farm_heartbeat", HeartbeatInputSchema, (input) => service.heartbeat(input));
  registerJsonTool(server, "farm_open_page", OpenPageInputSchema, (input) => service.openPage(input));
  registerJsonTool(server, "farm_capture", CaptureInputSchema, (input) => service.capture(input));
  registerJsonTool(server, "farm_wait", WaitInputSchema, (input) => service.wait(input));
  registerJsonTool(server, "farm_wait_for_selector", WaitForSelectorInputSchema, (input) => service.waitForSelector(input));
  registerJsonTool(server, "farm_scroll", ScrollInputSchema, (input) => service.scroll(input));
  registerJsonTool(server, "farm_capture_after_idle", CaptureAfterIdleInputSchema, (input) => service.captureAfterIdle(input));
  registerJsonTool(server, "farm_sample_frames", SampleFramesInputSchema, (input) => service.sampleFrames(input));
  registerJsonTool(server, "farm_evidence_run", EvidenceRunInputSchema, (input) => service.evidenceRun(input), (result) => resultHasFailedClaimGate(result));
  registerJsonTool(server, "farm_close_page", ClosePageInputSchema, (input) => service.closePage(input));
  registerJsonTool(server, "farm_click", ClickInputSchema, (input) => service.click(input));
  registerJsonTool(server, "farm_fill", FillInputSchema, (input) => service.fill(input));
  registerJsonTool(server, "farm_press", PressInputSchema, (input) => service.press(input));
  registerJsonTool(server, "farm_select_option", SelectOptionInputSchema, (input) => service.selectOption(input));
  registerJsonTool(server, "farm_release_context", ReleaseContextInputSchema, (input) => service.releaseContext(input));
  registerJsonTool(server, "farm_list_leases", ListLeasesInputSchema, () => service.listLeases());
  registerJsonTool(server, "farm_reap_expired", ReapExpiredInputSchema, () => service.reapExpired());

  return server;
}

export async function runStdioServer(service = new FarmService()): Promise<void> {
  const server = createMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerJsonTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  schema: z.ZodObject<T>,
  handler: (input: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>,
  isErrorResult?: (result: unknown) => boolean
): void {
  server.registerTool(
    name,
    {
      title: name,
      description: `${name} for the Browser-Agent MCP Farm`,
      inputSchema: schema.shape
    } as never,
    async (input: unknown) => {
      try {
        const result = await handler(schema.parse(input));
        return {
          ...(isErrorResult?.(result) ? { isError: true as const } : {}),
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(toToolError(error), null, 2) }]
        };
      }
    }
  );
}

function resultHasFailedClaimGate(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "ok" in result
    && (result as { ok?: unknown }).ok === false;
}
