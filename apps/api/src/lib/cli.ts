/**
 * Script arguments without the bare "--" that `pnpm <script> -- --flag` forwards
 * literally (node's parseArgs would treat everything after it as positional).
 */
export const cliArgs = () => process.argv.slice(2).filter((a) => a !== '--');
