// Creates an application user. The password comes from CIE_NEW_PASSWORD, or is asked
// for without echoing it.
//   npm run user:create -- --username ana --role admin
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { pool } from "@/lib/pg";
import { createUser, UserError } from "@/lib/auth/users";

const usage = "Usage: npm run user:create -- --username <name> --role <admin|developer>";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    output._writeToOutput = (text: string) => {
      if (text.startsWith(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { username: { type: "string" }, role: { type: "string" } } });
  if (!values.username || !values.role) throw new UserError(usage);
  const password = process.env.CIE_NEW_PASSWORD ?? (await askHidden("Password: "));
  const user = await createUser({ username: values.username, password, role: values.role });
  process.stdout.write(`Created ${user.role} ${user.username} (user_id ${user.userId})\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
