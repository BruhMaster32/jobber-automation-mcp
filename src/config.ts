import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  MCP_PATH_TOKEN: z.string().min(32),
  SETUP_KEY: z.string().min(32),
  JOBBER_CLIENT_ID: z.string().uuid(),
  JOBBER_CLIENT_SECRET: z.string().min(16),
  JOBBER_GRAPHQL_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  DATABASE_PATH: z.string().min(1).default("./data/rm-jobber-mcp.sqlite"),
  AUTOMATION_POLL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  ENABLE_AUTOMATION_WORKER: z.string().default("true").transform(value => value.toLowerCase() === "true")
});

export const config = schema.parse(process.env);
export const callbackUrl = `${config.PUBLIC_BASE_URL}/oauth/jobber/callback`;
export const mcpPath = `/mcp/${config.MCP_PATH_TOKEN}`;
