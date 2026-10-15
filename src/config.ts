export interface Config {
  allowWrite: boolean;
  machine?: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const UNEXPANDED_PLACEHOLDER = /^\$\{[^}]*\}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Reads herdr-mcp settings from the environment once, at startup.
 *
 * Write mode is enabled only by the exact value `1`. An unset, empty, or
 * unexpanded `${VAR}` value (left behind by clients that don't substitute
 * plugin variables) means "not configured".
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const allowWrite = env.HERDR_MCP_ALLOW_WRITE === "1";
  const machine = normalize(env.HERDR_MCP_MACHINE);

  if (machine !== undefined) {
    if (machine.startsWith("-") || CONTROL_CHARS.test(machine) || machine.length > 128) {
      throw new ConfigError(
        "HERDR_MCP_MACHINE must be a saved herdr machine label or profile ID (see `herdr machine list`)."
      );
    }
  }

  return machine === undefined ? { allowWrite } : { allowWrite, machine };
}

function normalize(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || UNEXPANDED_PLACEHOLDER.test(trimmed)) return undefined;
  return trimmed;
}
